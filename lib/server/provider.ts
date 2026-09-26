import Provider, { type ClientMetadata, type Configuration, type KoaContextWithOIDC } from 'oidc-provider'
import { resourcePath } from '@fairgarden/id/lib/api/group'
import { accountClaims, findAccount } from './accounts.ts'
import { findGrantId, PostgresAdapter } from './adapter.ts'
import { fetchDelegatedClaims } from './claims.ts'
import { ACCOUNT_CLIENT_ID, getConfig, type Config, type Service } from './config.ts'
import { db } from './db.ts'
import { loadKeys, type KeySet } from './keys.ts'
import { claimsByScope } from './scopes.ts'

/**
 * The OpenID Provider.
 *
 * Built once per process from the environment and the current keys, and
 * rebuilt when the keys change: they are checked at most once a minute, so a
 * rotation reaches every running instance without a redeploy.
 */

const REFRESH_MS = 60_000

interface State {
  provider: Provider
  keys: KeySet
  checkedAt: number
}

// Module scope rather than global: a reload in development should rebuild it
// with the new code.
let state: State | undefined
let pending: Promise<State> | undefined

const current = async (): Promise<State> => {
  if (state && Date.now() - state.checkedAt < REFRESH_MS) return state
  pending ??= (async () => {
    try {
      const keys = await loadKeys(await db())
      state =
        state && state.keys.version === keys.version
          ? { ...state, checkedAt: Date.now() }
          : { provider: build(keys), keys, checkedAt: Date.now() }
      return state
    } finally {
      pending = undefined
    }
  })()
  return pending
}

export const getProvider = async (): Promise<Provider> => (await current()).provider

/** The key tokens are signed with right now. */
export const currentSigningKey = async () => (await current()).keys.jwks.keys[0]

const serviceClient = (service: Service): ClientMetadata => ({
  client_id: service.id,
  client_name: service.name,
  ...(service.url ? { client_uri: service.url } : {}),
  ...(service.secret
    ? { client_secret: service.secret, token_endpoint_auth_method: 'client_secret_basic' }
    : { token_endpoint_auth_method: 'none' }),
  redirect_uris: service.redirectUris,
  post_logout_redirect_uris: service.postLogoutRedirectUris,
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  ...service.metadata,
})

/**
 * The account page signs in through the same flow as any service, asking for
 * no token at all (`response_type=none`): the session is what it wants.
 */
const accountClient = (config: Config): ClientMetadata => ({
  client_id: ACCOUNT_CLIENT_ID,
  client_name: config.brand.name,
  token_endpoint_auth_method: 'none',
  redirect_uris: [`${config.issuer}/account`],
  post_logout_redirect_uris: [`${config.issuer}/account`],
  grant_types: [],
  response_types: ['none'],
})

/** Pages rendered by the app rather than by oidc-provider, so they share its design. */
const page = (config: Config, path: string, params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))
  )
  return `${config.mount}${path}${search.size ? `?${search}` : ''}`
}

const build = (keys: KeySet): Provider => {
  const config = getConfig()
  const claims = claimsByScope()

  const configuration: Configuration = {
    adapter: PostgresAdapter,
    clients: [...config.services.map(serviceClient), accountClient(config)],
    jwks: keys.jwks as Configuration['jwks'],
    cookies: {
      names: { session: 'fg_id_session', interaction: 'fg_id_interaction', resume: 'fg_id_resume' },
      keys: keys.cookieKeys,
      long: { httpOnly: true, sameSite: 'lax', path: config.mount || '/' },
      short: { httpOnly: true, sameSite: 'lax' },
    },
    claims,
    scopes: ['openid', 'offline_access', ...Object.keys(claims)],
    // Put granted claims in the ID token as well as at userinfo; most
    // clients read them from the ID token.
    conformIdTokenClaims: false,
    responseTypes: ['code', 'none'],
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      introspection: { enabled: true },
      revocation: { enabled: true },
      rpInitiatedLogout: {
        enabled: true,
        async logoutSource(ctx, _form) {
          const client = ctx.oidc.client
          ctx.redirect(
            page(config, '/sign-out', {
              xsrf: ctx.oidc.session?.state?.secret as string | undefined,
              client: client?.clientName ?? client?.clientId,
            })
          )
        },
        async postLogoutSuccessSource(ctx) {
          const client = ctx.oidc.client
          ctx.redirect(page(config, '/signed-out', { client: client?.clientName ?? client?.clientId }))
        },
      },
    },
    interactions: {
      // The interaction's resource in the REST API, so its cookie — scoped to
      // this path — reaches every request made for it. Opened in a browser, it
      // redirects to the page.
      url: (_ctx, interaction) => resourcePath(config.mount, `interactions/${interaction.uid}`),
    },
    async renderError(ctx, out) {
      ctx.redirect(
        page(config, '/error', { error: out.error, description: out.error_description })
      )
    },
    async findAccount(ctx: KoaContextWithOIDC, sub: string) {
      const account = await findAccount(await db(), sub)
      if (!account) return undefined
      return {
        accountId: account.id,
        async claims(_use, scope) {
          const client = ctx.oidc.client
          const { claims: delegated } = client
            ? await fetchDelegatedClaims({
                subject: account.id,
                client: { id: client.clientId, name: client.clientName ?? client.clientId },
                scopes: new Set(scope.split(' ')),
                purpose: 'Release',
                signingJwk: keys.jwks.keys[0],
              })
            : { claims: {} }
          // Ours last, so a service can never overwrite them.
          return { ...delegated, ...accountClaims(account) }
        },
      }
    },
    async loadExistingGrant(ctx) {
      const { client, session, result } = ctx.oidc
      const grantId =
        result?.consent?.grantId ||
        session!.grantIdFor(client!.clientId) ||
        (await findGrantId(session!.accountId!, client!.clientId))
      if (grantId) {
        const grant = await ctx.oidc.provider.Grant.find(grantId)
        if (grant) return grant
      }
      // Signing in to the account page shares nothing, so it asks nothing.
      if (client!.clientId === ACCOUNT_CLIENT_ID) {
        const grant = new ctx.oidc.provider.Grant({
          clientId: client!.clientId,
          accountId: session!.accountId,
        })
        grant.addOIDCScope('openid')
        await grant.save()
        return grant
      }
      return undefined
    },
    ttl: {
      AccessToken: 60 * 60,
      AuthorizationCode: 60,
      IdToken: 60 * 60,
      Interaction: 60 * 60,
      RefreshToken: 14 * 24 * 60 * 60,
      Session: 14 * 24 * 60 * 60,
      Grant: 365 * 24 * 60 * 60,
    },
  }

  const provider = new Provider(config.issuer, configuration)
  // Behind Vercel, a load balancer or a monolith's rewrites, the protocol and
  // host come from X-Forwarded-*.
  provider.proxy = true
  provider.on('server_error', (_ctx, error) => console.error('[id] oidc-provider error', error))
  return provider
}
