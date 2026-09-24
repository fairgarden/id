import type Provider from 'oidc-provider'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { and, desc, eq, like, sql } from 'drizzle-orm'
import { newestFirst, type DecisionLogRow } from '@fairgarden/policy/drizzle'
import { API_GROUP, API_VERSION, GROUP_VERSION } from '@fairgarden-private/id/lib/api/group'
import * as api from '@fairgarden-private/id/lib/api/schemas'
import { listGrants as grantsOf, revokeGrant } from './adapter.ts'
import {
  deletePasskey as removePasskey,
  findAccount,
  listPasskeys as passkeysOf,
  renamePasskey,
  type Account,
} from './accounts.ts'
import {
  list,
  patchAccount as applyAccountPatch,
  success,
  toApiAccount,
  toApiPasskey,
} from './api-resources.ts'
import { defineRoute, type Route, type RouteContext } from './api-route.ts'
import { ACCOUNT_CLIENT_ID, getConfig } from './config.ts'
import { db } from './db.ts'
import { ApiError } from './errors.ts'
import { registrationOptions, verifyRegistration } from './passkeys.ts'
import { authorize, type AuthorizationInput, type ReleaseInput } from './policy.ts'
import { mockMessages, policyDecisions } from './schema.ts'
import { scopeInfo } from './scopes.ts'

/**
 * What a signed-in person can see and change about themselves, through the
 * session this service keeps in its own cookie. Every request is put to
 * policy first.
 */

const sessionOf = async ({ oidc, provider }: RouteContext) => {
  const session = await provider.Session.get(provider.createContext(oidc.req, oidc.res))
  return session.accountId ? session : undefined
}

/**
 * Who is asking, and whether policy lets them. `owner` is whose object it
 * is, when the request names one.
 */
const authorized = async (
  context: RouteContext,
  verb: AuthorizationInput['verb'],
  resource: string,
  { name, owner }: { name?: string; owner?: (account: Account) => Promise<string | undefined> | string | undefined } = {}
): Promise<{ account: Account; sessionUid: string }> => {
  const session = await sessionOf(context)
  const account = session ? await findAccount(await db(), session.accountId!) : undefined
  const decision = await authorize({
    user: { name: account?.id ?? null, authenticated: Boolean(account) },
    verb,
    resource: {
      group: API_GROUP,
      version: API_VERSION,
      resource,
      ...(name ? { name } : {}),
      ...(owner && account ? { owner: await owner(account) } : {}),
    },
  })
  if (!account) throw new ApiError(401, 'Unauthorized', decision.reason ?? 'Sign in first.')
  if (!decision.allowed) throw new ApiError(403, 'Forbidden', decision.reason ?? 'Not allowed.')
  return { account, sessionUid: session!.uid }
}

/** `me` names whoever is signed in. */
const accountName = (name: string, account: Account) => (name === 'me' ? account.id : name)

const signInUrl = () => {
  const { issuer } = getConfig()
  const params = new URLSearchParams({
    client_id: ACCOUNT_CLIENT_ID,
    response_type: 'none',
    scope: 'openid',
    redirect_uri: `${issuer}/account`,
  })
  return `${issuer}/oidc/auth?${params}`
}

const signOutUrl = () => {
  const { issuer } = getConfig()
  const params = new URLSearchParams({
    client_id: ACCOUNT_CLIENT_ID,
    post_logout_redirect_uri: `${issuer}/account`,
  })
  return `${issuer}/oidc/session/end?${params}`
}

const toApiGrant = async (
  provider: Provider,
  grant: Awaited<ReturnType<typeof grantsOf>>[number]
): Promise<api.Grant> => {
  const client = await provider.Client.find(grant.clientId)
  const scopes = (value: string) => value.split(' ').filter(Boolean)
  return {
    apiVersion: GROUP_VERSION,
    kind: 'Grant',
    metadata: {
      name: grant.id,
      creationTimestamp: grant.issuedAt ? new Date(grant.issuedAt * 1000).toISOString() : undefined,
    },
    spec: {
      clientId: grant.clientId,
      scopes: scopes(grant.scope),
      rejectedScopes: scopes(grant.rejectedScope),
    },
    status: {
      client: {
        id: grant.clientId,
        name: client?.clientName ?? grant.clientId,
        uri: client?.clientUri ?? null,
      },
      shared: scopes(grant.scope).map((name) => ({ name, title: scopeInfo(name).title })),
    },
  }
}

export const readSession = defineRoute({
  method: 'GET',
  path: 'sessions/{name}',
  verb: 'get',
  operationId: 'readSession',
  summary: 'Find out who is signed in',
  description: '`current` is the only session. Never fails for want of one.',
  security: 'session',
  responses: { 200: { description: 'The session', schema: api.Session } },
  async handle(context) {
    if (context.params.name !== 'current') {
      throw new ApiError(404, 'NotFound', 'The only session is `current`.')
    }
    const session = await sessionOf(context)
    const account = session ? await findAccount(await db(), session.accountId!) : undefined
    const { brand, issuer } = getConfig()
    const body: api.Session = {
      apiVersion: GROUP_VERSION,
      kind: 'Session',
      metadata: { name: 'current' },
      status: {
        authenticated: Boolean(account),
        account: account
          ? { name: account.id, email: account.email, displayName: account.name }
          : null,
        issuer: { name: brand.name, url: issuer },
        signInUrl: signInUrl(),
        signOutUrl: account ? signOutUrl() : null,
      },
    }
    return { status: 200, body }
  },
})

export const readAccount = defineRoute({
  method: 'GET',
  path: 'accounts/{name}',
  verb: 'get',
  operationId: 'readAccount',
  summary: 'Read an account',
  description: '`me` is whoever is signed in.',
  security: 'session',
  responses: { 200: { description: 'The account', schema: api.Account } },
  async handle(context) {
    const { account } = await authorized(context, 'get', 'accounts', {
      name: context.params.name,
      owner: (me) => accountName(context.params.name, me),
    })
    return { status: 200, body: toApiAccount(account) }
  },
})

export const patchAccount = defineRoute({
  method: 'PATCH',
  path: 'accounts/{name}',
  verb: 'patch',
  operationId: 'patchAccount',
  summary: 'Change an account',
  description:
    'A JSON merge patch of `spec`. Send `metadata.resourceVersion` to refuse overwriting a newer change.',
  security: 'session',
  body: api.AccountPatch,
  contentTypes: ['application/merge-patch+json', 'application/json'],
  responses: {
    200: { description: 'The account', schema: api.Account },
    409: { description: 'Changed since it was read', schema: api.Status },
  },
  async handle(context, body) {
    const { account } = await authorized(context, 'patch', 'accounts', {
      name: context.params.name,
      owner: (me) => accountName(context.params.name, me),
    })
    return { status: 200, body: await applyAccountPatch(await db(), account, body) }
  },
})

export const listPasskeys = defineRoute({
  method: 'GET',
  path: 'passkeys',
  verb: 'list',
  operationId: 'listPasskeys',
  summary: "List the signed-in person's passkeys",
  security: 'session',
  responses: { 200: { description: 'Their passkeys', schema: api.PasskeyList } },
  async handle(context) {
    const { account } = await authorized(context, 'list', 'passkeys', { owner: (me) => me.id })
    const passkeys = await passkeysOf(await db(), account.id)
    return { status: 200, body: list('PasskeyList', passkeys.map(toApiPasskey)) }
  },
})

export const createPasskeyChallenge = defineRoute({
  method: 'POST',
  path: 'passkeychallenges',
  verb: 'create',
  operationId: 'createPasskeyChallenge',
  summary: 'Start adding a passkey',
  description: 'Only `Register`; signing in with a passkey happens in an interaction.',
  security: 'session',
  body: api.PasskeyChallengeCreate,
  responses: { 201: { description: 'Options for the browser', schema: api.PasskeyChallenge } },
  async handle(context, body) {
    const { account, sessionUid } = await authorized(context, 'create', 'passkeychallenges', {
      owner: (me) => me.id,
    })
    if (body.spec.purpose !== 'Register') {
      throw new ApiError(422, 'Invalid', 'Only Register challenges are made here.')
    }
    const key = `session:${sessionUid}:register`
    const { options, expiresAt } = await registrationOptions(await db(), key, account)
    const challenge: api.PasskeyChallenge = {
      apiVersion: GROUP_VERSION,
      kind: 'PasskeyChallenge',
      metadata: { name: key, creationTimestamp: new Date().toISOString() },
      spec: { purpose: 'Register' },
      status: {
        options: options as unknown as Record<string, unknown>,
        expiresTimestamp: expiresAt.toISOString(),
      },
    }
    return { status: 201, body: challenge }
  },
})

export const createPasskey = defineRoute({
  method: 'POST',
  path: 'passkeys',
  verb: 'create',
  operationId: 'createPasskey',
  summary: 'Add a passkey',
  description: 'Answers the latest `Register` PasskeyChallenge.',
  security: 'session',
  body: api.PasskeyCreate,
  responses: { 201: { description: 'The passkey', schema: api.Passkey } },
  async handle(context, body) {
    const { account, sessionUid } = await authorized(context, 'create', 'passkeys', {
      owner: (me) => me.id,
    })
    const passkey = await verifyRegistration(
      await db(),
      `session:${sessionUid}:register`,
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

export const patchPasskey = defineRoute({
  method: 'PATCH',
  path: 'passkeys/{name}',
  verb: 'patch',
  operationId: 'patchPasskey',
  summary: 'Rename a passkey',
  security: 'session',
  body: api.PasskeyPatch,
  contentTypes: ['application/merge-patch+json', 'application/json'],
  responses: { 200: { description: 'The passkey', schema: api.Passkey } },
  async handle(context, body) {
    const { account } = await authorized(context, 'patch', 'passkeys', {
      name: context.params.name,
      owner: (me) => me.id,
    })
    const passkey = await renamePasskey(await db(), account.id, context.params.name, body.spec.displayName)
    if (!passkey) throw new ApiError(404, 'NotFound', 'No such passkey.')
    return { status: 200, body: toApiPasskey(passkey) }
  },
})

export const deletePasskey = defineRoute({
  method: 'DELETE',
  path: 'passkeys/{name}',
  verb: 'delete',
  operationId: 'deletePasskey',
  summary: 'Remove a passkey',
  security: 'session',
  responses: { 200: { description: 'Removed', schema: api.Status } },
  async handle(context) {
    const { account } = await authorized(context, 'delete', 'passkeys', {
      name: context.params.name,
      owner: (me) => me.id,
    })
    if (!(await removePasskey(await db(), account.id, context.params.name))) {
      throw new ApiError(404, 'NotFound', 'No such passkey.')
    }
    return {
      status: 200,
      body: success('Removed the passkey.', { kind: 'passkeys', name: context.params.name }),
    }
  },
})

export const listGrants = defineRoute({
  method: 'GET',
  path: 'grants',
  verb: 'list',
  operationId: 'listGrants',
  summary: 'List what the signed-in person shares, service by service',
  security: 'session',
  responses: { 200: { description: 'Their grants', schema: api.GrantList } },
  async handle(context) {
    const { account } = await authorized(context, 'list', 'grants', { owner: (me) => me.id })
    const grants = (await grantsOf(account.id)).filter(
      (grant) => grant.clientId !== ACCOUNT_CLIENT_ID
    )
    const items = await Promise.all(grants.map((grant) => toApiGrant(context.provider, grant)))
    return { status: 200, body: list('GrantList', items) }
  },
})

export const deleteGrant = defineRoute({
  method: 'DELETE',
  path: 'grants/{name}',
  verb: 'delete',
  operationId: 'deleteGrant',
  summary: "Remove a service's access",
  description:
    'Its tokens stop working at once. Signing in to it again asks the person afresh what to share.',
  security: 'session',
  responses: { 200: { description: 'Removed', schema: api.Status } },
  async handle(context) {
    const grant = await context.provider.Grant.find(context.params.name)
    await authorized(context, 'delete', 'grants', {
      name: context.params.name,
      owner: () => grant?.accountId,
    })
    if (!grant) throw new ApiError(404, 'NotFound', 'No such grant.')
    await revokeGrant(context.params.name)
    return {
      status: 200,
      body: success(`Removed access for ${grant.clientId}.`, { kind: 'grants', name: context.params.name }),
    }
  },
})

/** What a recorded decision said, in words the person reading it follows. */
const summarize = (row: DecisionLogRow): string => {
  const decision = row.path.split('/').pop()
  if (row.error) return 'Could not be decided, so the answer was no.'
  if (decision === 'release') {
    const input = row.input as ReleaseInput
    const result = row.result as { scopes?: string[]; reasons?: Record<string, string> } | string[]
    const offered = new Set(Array.isArray(result) ? result : (result.scopes ?? []))
    const reasons = Array.isArray(result) ? {} : (result.reasons ?? {})
    const asked = input.scopes.map((scope) => scopeInfo(scope).title)
    const withheld = input.scopes
      .filter((scope) => scope !== 'openid' && !offered.has(scope))
      .map((scope) => (reasons[scope] ? `${scopeInfo(scope).title} — ${reasons[scope]}` : scopeInfo(scope).title))
    const verb = input.purpose === 'Preview' ? 'asked for' : 'was allowed to ask for'
    return `${input.client.name} ${verb} ${asked.join(', ')}. ${
      withheld.length ? `Not offered: ${withheld.join('; ')}.` : 'Policy offered all of it.'
    }`
  }
  const input = row.input as AuthorizationInput
  const result = row.result as { allow?: boolean; reason?: string } | boolean
  const allowed = typeof result === 'boolean' ? result : result.allow === true
  const reason = typeof result === 'boolean' ? undefined : result.reason
  const target = [input.resource.resource, input.resource.subresource].filter(Boolean).join('/')
  return `${allowed ? 'Allowed' : 'Refused'}: ${input.verb} ${target}${reason ? ` — ${reason}` : ''}`
}

const toApiDecision = (row: DecisionLogRow): api.PolicyDecision => ({
  apiVersion: GROUP_VERSION,
  kind: 'PolicyDecision',
  metadata: { name: row.id, creationTimestamp: row.decidedAt.toISOString() },
  spec: { decision: row.path.split('/').pop() ?? row.path, path: row.path, input: row.input ?? undefined },
  status: {
    result: row.result ?? undefined,
    // What went wrong stays in the audit log: it can name private paths and URLs.
    error: row.error ? 'The policy could not be evaluated.' : null,
    summary: summarize(row),
    engine: row.labels.engine ?? 'unknown',
    revision: row.labels.revision ?? 'unknown',
    erased: row.erased ?? [],
  },
})

export const listPolicyDecisions = defineRoute({
  method: 'GET',
  path: 'policydecisions',
  verb: 'list',
  operationId: 'listPolicyDecisions',
  summary: 'List the decisions policy made about the signed-in person',
  description:
    'Newest first. `?fieldSelector=` keeps some, Kubernetes style — `spec.decision=release`, `spec.input.purpose=Consent`, or both, comma separated; `?limit=` caps how many (default 50, at most 200).',
  security: 'session',
  responses: { 200: { description: 'Their decisions', schema: api.PolicyDecisionList } },
  async handle(context) {
    const { account } = await authorized(context, 'list', 'policydecisions', { owner: (me) => me.id })
    const query = new URL(context.request.url).searchParams
    const selected = new Map(
      (query.get('fieldSelector') ?? '')
        .split(',')
        .map((term) => /^(spec\.decision|spec\.input\.purpose)=([A-Za-z_]+)$/.exec(term.trim()))
        .filter((match) => match !== null)
        .map((match) => [match[1], match[2]])
    )
    const decision = selected.get('spec.decision')
    const purpose = selected.get('spec.input.purpose')
    const limit = Math.min(Math.max(Number(query.get('limit') ?? 50) || 50, 1), 200)
    const rows = await (await db())
      .select()
      .from(policyDecisions)
      .where(
        and(
          eq(policyDecisions.subject, account.id),
          decision ? like(policyDecisions.path, `%/${decision}`) : undefined,
          purpose ? sql`${policyDecisions.input} ->> 'purpose' = ${purpose}` : undefined
        )
      )
      .orderBy(...newestFirst(policyDecisions))
      .limit(limit)
    return { status: 200, body: list('PolicyDecisionList', rows.map(toApiDecision)) }
  },
})

export const accountRoutes: Route[] = [
  readSession,
  readAccount,
  patchAccount,
  listPasskeys,
  createPasskeyChallenge,
  createPasskey,
  patchPasskey,
  deletePasskey,
  listGrants,
  deleteGrant,
  listPolicyDecisions,
]

export const listMockMessages = defineRoute({
  method: 'GET',
  path: 'mockmessages',
  verb: 'list',
  operationId: 'listMockMessages',
  summary: 'Read the mock mailbox',
  description: 'Only when email is mocked, which is only on a local host unless forced.',
  security: 'none',
  responses: { 200: { description: 'Newest first', schema: api.MockMessageList } },
  async handle() {
    if (!getConfig().email.mock) throw new ApiError(404, 'NotFound', 'Email is not mocked here.')
    const rows = await (await db())
      .select()
      .from(mockMessages)
      .orderBy(desc(mockMessages.id))
      .limit(50)
    const items: api.MockMessage[] = rows.map((row) => ({
      apiVersion: GROUP_VERSION,
      kind: 'MockMessage',
      metadata: { name: String(row.id), creationTimestamp: row.createdAt.toISOString() },
      spec: { to: row.to, subject: row.subject, text: row.text, html: row.html },
    }))
    return { status: 200, body: list('MockMessageList', items) }
  },
})

export const deleteMockMessages = defineRoute({
  method: 'DELETE',
  path: 'mockmessages',
  verb: 'deletecollection',
  operationId: 'deleteMockMessages',
  summary: 'Empty the mock mailbox',
  security: 'none',
  responses: { 200: { description: 'Emptied', schema: api.Status } },
  async handle() {
    if (!getConfig().email.mock) throw new ApiError(404, 'NotFound', 'Email is not mocked here.')
    await (await db()).delete(mockMessages)
    return { status: 200, body: success('Emptied the mock mailbox.') }
  },
})

export const sessionRoutes: Route[] = [...accountRoutes, listMockMessages, deleteMockMessages]

