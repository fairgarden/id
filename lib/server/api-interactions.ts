import type Provider from 'oidc-provider'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { GROUP_VERSION } from '@fairgarden/id/lib/api/group'
import * as api from '@fairgarden/id/lib/api/schemas'
import { findAccount, findOrCreateAccountByEmail, listPasskeys, normalizeEmail, type Account } from './accounts.ts'
import { prefersHtml } from './api-http.ts'
import { patchAccount, toApiAccount, toApiPasskey } from './api-resources.ts'
import { defineRoute, type Route, type RouteContext } from './api-route.ts'
import { fetchDelegatedClaims } from './claims.ts'
import { getConfig } from './config.ts'
import { db, type Database } from './db.ts'
import { ApiError, invalid } from './errors.ts'
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from './passkeys.ts'
import { decideRelease } from './policy.ts'
import { currentSigningKey } from './provider.ts'
import { previewOwnScope, scopeInfo } from './scopes.ts'
import {
  pendingEmailChallenge,
  startEmailChallenge,
  verifyEmailCode,
  verifyEmailLink,
} from './sign-in.ts'

/**
 * `interactions`: a sign-in in progress, and everything done to finish it.
 *
 * oidc-provider sends the browser here with a cookie scoped to this path, so
 * the cookie is what proves a request comes from the browser that started
 * the sign-in; knowing its name is not enough.
 */

type OidcInteraction = Awaited<ReturnType<Provider['interactionDetails']>>

const load = async ({ oidc, params, provider }: RouteContext): Promise<OidcInteraction> => {
  let interaction: OidcInteraction
  try {
    interaction = await provider.interactionDetails(oidc.req, oidc.res)
  } catch (error) {
    // oidc-provider's message is the error code; what went wrong is here.
    const description = (error as { error_description?: string }).error_description ?? ''
    if (/cookie not found/.test(description)) {
      throw new ApiError(
        403,
        'Forbidden',
        'Open this in the browser where you started signing in.'
      )
    }
    console.warn('[id] interaction not found:', description || (error as Error).message)
    throw new ApiError(
      410,
      'Gone',
      'This sign-in has expired. Go back to where you were signing in and start again.'
    )
  }
  if (interaction.uid !== params.name) {
    throw new ApiError(404, 'NotFound', 'There is no such sign-in in this browser.', {
      kind: 'Interaction',
      name: params.name,
    })
  }
  return interaction
}

const phaseOf = (interaction: OidcInteraction): api.InteractionPhase => {
  const result = interaction.result ?? {}
  if (result.error) return 'Aborted'
  if (result.consent) return 'Completed'
  if (interaction.prompt.name === 'consent') return 'ConsentRequired'
  return result.login?.accountId ? 'Authenticated' : 'LoginRequired'
}

const clientOf = async (provider: Provider, interaction: OidcInteraction) => {
  const clientId = String(interaction.params.client_id)
  const client = await provider.Client.find(clientId)
  return {
    id: clientId,
    name: client?.clientName ?? clientId,
    uri: client?.clientUri ?? null,
  }
}

const accountOf = async (database: Database, interaction: OidcInteraction) => {
  const accountId =
    interaction.result?.login?.accountId ??
    (interaction.prompt.name === 'consent' ? interaction.session?.accountId : undefined)
  return accountId ? findAccount(database, accountId) : undefined
}

/** A delegated claim, as lines of text a person can read. */
const describe = (value: unknown): string[] => {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return [value.length ? value.map(String).join(', ') : 'none']
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) =>
      describe(inner).map((line) => `${key}: ${line}`)
    )
  }
  return [String(value)]
}

/**
 * The scopes to ask about: those not answered yet — or, when the service asks
 * for consent again (`prompt=consent`), everything it asked for, so the person
 * can share what they declined before, or stop sharing something.
 */
const scopesToAsk = (interaction: OidcInteraction): string[] => {
  const missing = (interaction.prompt.details as { missingOIDCScope?: string[] }).missingOIDCScope ?? []
  if (!interaction.prompt.reasons.includes('consent_prompt')) return missing
  const requested = String(interaction.params.scope ?? '').split(' ').filter(Boolean)
  return [...new Set([...requested, ...missing])]
}

/** What the person answered last time, scope by scope. */
const previousAnswers = async (provider: Provider, interaction: OidcInteraction) => {
  const grant = interaction.grantId ? await provider.Grant.find(interaction.grantId) : undefined
  const answers = new Map<string, 'granted' | 'refused'>()
  for (const scope of grant?.getRejectedOIDCScope().split(' ') ?? []) if (scope) answers.set(scope, 'refused')
  for (const scope of grant?.getOIDCScope().split(' ') ?? []) if (scope) answers.set(scope, 'granted')
  return answers
}

const consentScopes = async (
  provider: Provider,
  interaction: OidcInteraction,
  account: Account,
  client: { id: string; name: string }
): Promise<api.ScopeRequest[]> => {
  const missing = scopesToAsk(interaction)
  const previously = await previousAnswers(provider, interaction)
  const release = await decideRelease({
    user: { name: account.id },
    client,
    scopes: missing,
    purpose: 'Preview',
  })
  const available = new Set(release.scopes)

  // What the other services would share, so the person sees it before agreeing.
  const delegatedScopes = missing.filter((scope) => available.has(scope) && scopeInfo(scope).source)
  const delegated = delegatedScopes.length
    ? await fetchDelegatedClaims({
        subject: account.id,
        client,
        scopes: new Set(delegatedScopes),
        purpose: 'Preview',
        signingJwk: await currentSigningKey(),
      })
    : { claims: {}, reasons: {} }

  return missing.map((name) => {
    const info = scopeInfo(name)
    // What another service would share, and what its own policy keeps back.
    const withheld = info.source
      ? Object.entries(delegated.reasons)
          .filter(([what]) => info.claims.some((claim) => what === claim || what.startsWith(`${claim}.`)))
          .map(([, reason]) => `Not shared: ${reason}`)
      : []
    const preview = info.source
      ? [...info.claims.flatMap((claim) => describe(delegated.claims[claim])), ...withheld]
      : (previewOwnScope(name, account) ?? null)
    return {
      name,
      title: info.title,
      description: info.description,
      claims: info.claims,
      sensitive: info.sensitive,
      required: info.required,
      source: info.source?.name ?? null,
      available: available.has(name),
      reason: available.has(name) ? null : (release.reasons[name] ?? null),
      preview,
      previously: previously.get(name) ?? null,
    }
  })
}

const toInteraction = async (
  provider: Provider,
  interaction: OidcInteraction
): Promise<api.Interaction> => {
  const database = await db()
  const config = getConfig()
  const phase = phaseOf(interaction)
  const client = await clientOf(provider, interaction)
  const account = await accountOf(database, interaction)
  const pending =
    phase === 'LoginRequired' ? await pendingEmailChallenge(database, interaction.uid) : undefined

  return {
    apiVersion: GROUP_VERSION,
    kind: 'Interaction',
    metadata: {
      name: interaction.uid,
      creationTimestamp: new Date(interaction.iat! * 1000).toISOString(),
    },
    spec: {
      prompt: interaction.prompt.name === 'consent' ? 'consent' : 'login',
      issuer: { name: config.brand.name, url: config.issuer },
      client,
      loginHint: typeof interaction.params.login_hint === 'string' ? interaction.params.login_hint : null,
      scopes: String(interaction.params.scope ?? '').split(' ').filter(Boolean),
    },
    status: {
      phase,
      account: account
        ? {
            name: account.id,
            email: account.email,
            displayName: account.name,
            passkeys: (await listPasskeys(database, account.id)).length,
          }
        : null,
      emailChallenge: pending
        ? {
            email: pending.email,
            expiresTimestamp: pending.expiresAt.toISOString(),
            mockMailbox: config.email.mock ? `${config.mount}/dev/mailbox` : null,
          }
        : null,
      consent:
        phase === 'ConsentRequired' && account
          ? { scopes: await consentScopes(provider, interaction, account, client) }
          : null,
      returnTo: ['Authenticated', 'Completed', 'Aborted'].includes(phase)
        ? interaction.returnTo
        : null,
    },
  }
}

const requirePhase = (interaction: OidcInteraction, ...phases: api.InteractionPhase[]) => {
  const phase = phaseOf(interaction)
  if (!phases.includes(phase)) {
    throw new ApiError(409, 'Conflict', `This sign-in is ${phase}, so that cannot be done now.`, {
      kind: 'Interaction',
      name: interaction.uid,
    })
  }
}

const authenticatedAccount = async (interaction: OidcInteraction): Promise<Account> => {
  requirePhase(interaction, 'Authenticated')
  const account = await findAccount(await db(), interaction.result!.login!.accountId)
  if (!account) throw new ApiError(410, 'Gone', 'That account no longer exists.')
  return account
}

/** Record who signed in; the page then offers the rest of setting up. */
const signIn = async (
  { oidc, provider }: RouteContext,
  accountId: string,
  amr: string[]
): Promise<api.Interaction> => {
  await provider.interactionResult(
    oidc.req,
    oidc.res,
    { login: { accountId, amr, remember: true } },
    { mergeWithLastSubmission: false }
  )
  return toInteraction(provider, await provider.interactionDetails(oidc.req, oidc.res))
}

const interactionResponses = {
  200: { description: 'The interaction', schema: api.Interaction },
}

export const readInteraction = defineRoute({
  method: 'GET',
  path: 'interactions/{name}',
  verb: 'get',
  operationId: 'readInteraction',
  summary: 'Read a sign-in in progress',
  description: 'Opened in a browser (`Accept: text/html`), redirects to the sign-in page.',
  security: 'interaction',
  responses: { ...interactionResponses, 303: { description: 'To the sign-in page' } },
  async handle(context) {
    if (prefersHtml(context.request)) {
      return { redirect: `${getConfig().mount}/interaction/${context.params.name}` }
    }
    return { status: 200, body: await toInteraction(context.provider, await load(context)) }
  },
})

export const deleteInteraction = defineRoute({
  method: 'DELETE',
  path: 'interactions/{name}',
  verb: 'delete',
  operationId: 'deleteInteraction',
  summary: 'Cancel signing in',
  description: 'The service is told the person declined. Follow `status.returnTo`.',
  security: 'interaction',
  responses: interactionResponses,
  async handle(context) {
    const { oidc, provider } = context
    await load(context)
    await provider.interactionResult(
      oidc.req,
      oidc.res,
      { error: 'access_denied', error_description: 'The person cancelled signing in.' },
      { mergeWithLastSubmission: false }
    )
    return {
      status: 200,
      body: await toInteraction(provider, await provider.interactionDetails(oidc.req, oidc.res)),
    }
  },
})

export const createInteractionEmailChallenge = defineRoute({
  method: 'POST',
  path: 'interactions/{name}/emailchallenge',
  verb: 'create',
  operationId: 'createInteractionEmailChallenge',
  summary: 'Email a sign-in code and link',
  description:
    'Sent whether or not an account exists: proving the address is how one is created.',
  security: 'interaction',
  body: api.EmailChallengeCreate,
  responses: {
    201: { description: 'Sent', schema: api.EmailChallenge },
    429: { description: 'Sent too recently, or too often', schema: api.Status },
  },
  async handle(context, body) {
    const interaction = await load(context)
    requirePhase(interaction, 'LoginRequired')
    const email = normalizeEmail(body.spec.email)
    if (!email) throw invalid('spec.email', 'Enter an email address, like name@example.com.')
    const { expiresAt, resendAfter } = await startEmailChallenge(await db(), interaction.uid, email)
    const challenge: api.EmailChallenge = {
      apiVersion: GROUP_VERSION,
      kind: 'EmailChallenge',
      metadata: { name: interaction.uid, creationTimestamp: new Date().toISOString() },
      spec: { email },
      status: {
        expiresTimestamp: expiresAt.toISOString(),
        resendAfterTimestamp: resendAfter.toISOString(),
      },
    }
    return { status: 201, body: challenge }
  },
})

export const createInteractionPasskeyChallenge = defineRoute({
  method: 'POST',
  path: 'interactions/{name}/passkeychallenge',
  verb: 'create',
  operationId: 'createInteractionPasskeyChallenge',
  summary: 'Start signing in with a passkey, or adding one',
  description:
    '`Authenticate` before signing in; `Register` once signed in, to add a passkey for next time.',
  security: 'interaction',
  body: api.PasskeyChallengeCreate,
  responses: { 201: { description: 'Options for the browser', schema: api.PasskeyChallenge } },
  async handle(context, body) {
    const interaction = await load(context)
    const database = await db()
    const { purpose } = body.spec
    const key = `interaction:${interaction.uid}:${purpose.toLowerCase()}`
    let result
    if (purpose === 'Authenticate') {
      requirePhase(interaction, 'LoginRequired')
      result = await authenticationOptions(database, key)
    } else {
      result = await registrationOptions(database, key, await authenticatedAccount(interaction))
    }
    const challenge: api.PasskeyChallenge = {
      apiVersion: GROUP_VERSION,
      kind: 'PasskeyChallenge',
      metadata: { name: key, creationTimestamp: new Date().toISOString() },
      spec: { purpose },
      status: {
        options: result.options as unknown as Record<string, unknown>,
        expiresTimestamp: result.expiresAt.toISOString(),
      },
    }
    return { status: 201, body: challenge }
  },
})

export const createInteractionLogin = defineRoute({
  method: 'POST',
  path: 'interactions/{name}/login',
  verb: 'create',
  operationId: 'createInteractionLogin',
  summary: 'Sign in',
  description:
    'With the emailed code, the emailed link’s token, or a passkey answering an `Authenticate` challenge.',
  security: 'interaction',
  body: api.LoginCreate,
  responses: interactionResponses,
  async handle(context, body) {
    const interaction = await load(context)
    requirePhase(interaction, 'LoginRequired')
    const database = await db()
    const { spec } = body

    if (spec.method === 'Passkey') {
      const { passkey, userVerified } = await verifyAuthentication(
        database,
        `interaction:${interaction.uid}:authenticate`,
        spec.credential as unknown as AuthenticationResponseJSON
      )
      const amr = userVerified ? ['pop', 'mfa'] : ['pop']
      return { status: 200, body: await signIn(context, passkey.accountId, amr) }
    }

    const email =
      spec.method === 'EmailCode'
        ? await verifyEmailCode(database, interaction.uid, spec.code)
        : await verifyEmailLink(database, interaction.uid, spec.token)
    const { account } = await findOrCreateAccountByEmail(database, email)
    return { status: 200, body: await signIn(context, account.id, ['otp']) }
  },
})

export const readInteractionAccount = defineRoute({
  method: 'GET',
  path: 'interactions/{name}/account',
  verb: 'get',
  operationId: 'readInteractionAccount',
  summary: 'Read the account that just signed in',
  security: 'interaction',
  responses: { 200: { description: 'The account', schema: api.Account } },
  async handle(context) {
    const account = await authenticatedAccount(await load(context))
    return { status: 200, body: toApiAccount(account) }
  },
})

export const patchInteractionAccount = defineRoute({
  method: 'PATCH',
  path: 'interactions/{name}/account',
  verb: 'patch',
  operationId: 'patchInteractionAccount',
  summary: 'Finish setting up the account that just signed in',
  security: 'interaction',
  body: api.AccountPatch,
  contentTypes: ['application/merge-patch+json', 'application/json'],
  responses: { 200: { description: 'The account', schema: api.Account } },
  async handle(context, body) {
    const account = await authenticatedAccount(await load(context))
    return { status: 200, body: await patchAccount(await db(), account, body) }
  },
})

export const createInteractionPasskey = defineRoute({
  method: 'POST',
  path: 'interactions/{name}/passkeys',
  verb: 'create',
  operationId: 'createInteractionPasskey',
  summary: 'Add a passkey for the account that just signed in',
  security: 'interaction',
  body: api.PasskeyCreate,
  responses: { 201: { description: 'The passkey', schema: api.Passkey } },
  async handle(context, body) {
    const interaction = await load(context)
    const account = await authenticatedAccount(interaction)
    const passkey = await verifyRegistration(
      await db(),
      `interaction:${interaction.uid}:register`,
      account,
      body.spec.credential as unknown as RegistrationResponseJSON,
      {
        displayName: body.spec.displayName,
        userAgent: context.request.headers.get('user-agent') ?? undefined,
      }
    )
    return { status: 201, body: toApiPasskey(passkey) }
  },
})

export const createInteractionConsent = defineRoute({
  method: 'POST',
  path: 'interactions/{name}/consent',
  verb: 'create',
  operationId: 'createInteractionConsent',
  summary: 'Agree to share some of what a service asked for',
  description:
    'Scopes left out are refused, and the service is not given them until it asks for consent again (`prompt=consent`), or the person removes its access and signs in again. Follow `status.returnTo`.',
  security: 'interaction',
  body: api.ConsentCreate,
  responses: interactionResponses,
  async handle(context, body) {
    const { oidc, provider } = context
    const interaction = await load(context)
    requirePhase(interaction, 'ConsentRequired')
    const accountId = interaction.session!.accountId!
    const client = await clientOf(provider, interaction)

    const missing = scopesToAsk(interaction)
    const available = new Set(
      (await decideRelease({ user: { name: accountId }, client, scopes: missing, purpose: 'Consent' })).scopes
    )
    const chosen = new Set(body.spec.scopes)
    const granted = missing.filter(
      (scope) => scopeInfo(scope).required || (available.has(scope) && chosen.has(scope))
    )
    const refused = missing.filter((scope) => !granted.includes(scope))

    const grant = interaction.grantId
      ? await provider.Grant.find(interaction.grantId)
      : new provider.Grant({ accountId, clientId: client.id })
    if (!grant) throw new ApiError(410, 'Gone', 'This sign-in has expired. Start again.')
    if (granted.length) grant.addOIDCScope(granted.join(' '))
    // Asked again: what they share now is no longer refused.
    const stillRefused = grant
      .getRejectedOIDCScope()
      .split(' ')
      .filter((scope) => scope && !granted.includes(scope))
    ;(grant as { rejected?: unknown }).rejected = undefined
    const rejected = [...new Set([...stillRefused, ...refused])]
    if (rejected.length) grant.rejectOIDCScope(rejected.join(' '))
    const grantId = await grant.save()

    await provider.interactionResult(
      oidc.req,
      oidc.res,
      { consent: { grantId } },
      { mergeWithLastSubmission: true }
    )
    return {
      status: 200,
      body: await toInteraction(provider, await provider.interactionDetails(oidc.req, oidc.res)),
    }
  },
})

export const interactionRoutes: Route[] = [
  readInteraction,
  deleteInteraction,
  createInteractionEmailChallenge,
  createInteractionPasskeyChallenge,
  createInteractionLogin,
  readInteractionAccount,
  patchInteractionAccount,
  createInteractionPasskey,
  createInteractionConsent,
]
