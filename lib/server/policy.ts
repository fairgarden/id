import {
  BundleRejectedError,
  createPolicy,
  jsonLinesLogger,
  PolicyUnavailableError,
  type Disclosure,
  type EngineName,
  type Policy,
} from '@fairgarden/policy'
import { drizzleLogger, drizzleRevisions } from '@fairgarden/policy/drizzle'
import { getConfig } from './config.ts'
import { db } from './db.ts'
import { ApiError } from './errors.ts'
import { policyDecisions, policyRevisions } from './schema.ts'

/**
 * Every authorization decision this service makes, through
 * `@fairgarden/policy`: the built-in rules below, or the organization's
 * signed policy (`FG_POLICY_BUNDLE`), or an OPA server (`FG_POLICY_OPA_URL`).
 * Each decision is a rule in the package `FG_ID_POLICY_PACKAGE`
 * (`fairgarden/id`); policies/id.rego is those rules as id ships them, for
 * the organization to build on. Every decision is recorded in
 * `id_policy_decisions` for audits, labelled with the revision that made it,
 * and every revision in `id_policy_revisions`, so the two can be read side
 * by side. If a decision cannot be made, the answer is no.
 */

/**
 * `authz`: may this person do this to this resource? The attributes are a
 * Kubernetes SubjectAccessReview's, so policies written for one read the same.
 */
export interface AuthorizationInput {
  user: {
    /** The account ID, or null for someone not signed in. */
    name: string | null
    authenticated: boolean
  }
  verb: 'get' | 'list' | 'create' | 'update' | 'patch' | 'delete' | 'deletecollection'
  resource: {
    group: string
    version: string
    resource: string
    subresource?: string
    name?: string
    /** Whose object it is, where it belongs to someone. */
    owner?: string
  }
}

/**
 * `release`: which of these scopes may this service be given at all, and why
 * not the others? The reasons are shown to the person on the consent screen,
 * so what the policy keeps from a service is never a mystery.
 */
export interface ReleaseInput {
  user: { name: string }
  client: { id: string; name: string }
  scopes: string[]
  /** `Preview` while the consent screen is shown, `Consent` when the answer is recorded. */
  purpose: 'Preview' | 'Consent'
}

type IdDecisions = {
  authz: { input: AuthorizationInput; result: { allow?: boolean; reason?: string } | boolean }
  release: {
    input: ReleaseInput
    result: { scopes?: string[]; reasons?: Record<string, string> } | string[]
  }
}

export interface Decision {
  allowed: boolean
  reason?: string
}

export interface Release {
  /** The scopes this service may be offered. */
  scopes: string[]
  /** Why each withheld scope was, in words the person is shown. */
  reasons: Record<string, string>
}

/**
 * Built in: anyone may ask who they are and read the mock mailbox (which is
 * only there locally); everything else needs someone signed in, acting on
 * their own things. A service may be offered any scope; the person decides.
 * policies/id.rego says the same in Rego, before an organization adds to it.
 */
const builtIn = {
  authz: ({ user, resource }: AuthorizationInput) => {
    if (resource.resource === 'sessions' || resource.resource === 'mockmessages') return { allow: true }
    if (!user.authenticated) return { allow: false, reason: 'Sign in first.' }
    if (resource.owner !== undefined && resource.owner !== user.name) {
      return { allow: false, reason: 'That belongs to someone else.' }
    }
    return { allow: true }
  },
  release: ({ scopes }: ReleaseInput) => ({ scopes, reasons: {} }),
}

const revisions = drizzleRevisions(db, policyRevisions)

let policy: Policy<IdDecisions> | undefined

const current = (): Policy<IdDecisions> => {
  if (policy) return policy
  const { policy: settings, policyLog } = getConfig()
  policy = createPolicy<IdDecisions>({
    package: settings.package,
    source: settings.source,
    builtIn,
    loggers: [drizzleLogger(db, policyDecisions), ...(policyLog.stdout ? [jsonLinesLogger()] : [])],
    onRevision: revisions.record,
    labels: { service: 'id' },
  })
  return policy
}

const decide = async <K extends keyof IdDecisions & string>(
  decision: K,
  input: IdDecisions[K]['input']
): Promise<IdDecisions[K]['result']> => {
  try {
    return await current().decide(decision, input)
  } catch (error) {
    if (!(error instanceof PolicyUnavailableError)) throw error
    console.error('[id] policy could not be evaluated', error.cause)
    throw new ApiError(503, 'ServiceUnavailable', 'Authorization is unavailable. Try again shortly.')
  }
}

export const authorize = async (input: AuthorizationInput): Promise<Decision> => {
  const result = await decide('authz', input)
  return typeof result === 'boolean'
    ? { allowed: result }
    : { allowed: result.allow === true, reason: result.reason }
}

export const decideRelease = async (input: ReleaseInput): Promise<Release> => {
  const result = await decide('release', input)
  const allowed = new Set(Array.isArray(result) ? result : (result.scopes ?? []))
  return {
    // `openid` is what signing in is; policy decides what comes with it.
    scopes: input.scopes.filter((scope) => scope === 'openid' || allowed.has(scope)),
    reasons: Array.isArray(result) ? {} : (result.reasons ?? {}),
  }
}

/** The built-in rules, described as an organization's policy describes its own. */
const BUILT_IN: Disclosure = {
  revision: 'builtin',
  organization: {},
  layers: [],
  data: {},
  packages: [
    {
      name: 'fairgarden.id',
      title: 'Your account',
      description:
        'Who may see and change an account, and what each service may be offered from it when you sign in.',
      related: [],
      decisions: [
        {
          name: 'authz',
          path: 'fairgarden/id/authz',
          title: 'Who may see and change an account',
          description: 'Only you can see or change your account, your passkeys and the services you share with.',
          related: [],
        },
        {
          name: 'release',
          path: 'fairgarden/id/release',
          title: 'What a service may ask you for',
          description: 'A service is offered everything it asks for. You choose what to share.',
          related: [],
        },
      ],
      sources: [],
    },
  ],
}

export interface PolicyState {
  engine: EngineName
  /** When this service first ran it; only for a past revision. */
  firstUsedAt?: Date
  /** What it decides, and the rules; absent when an OPA server holds them, or the bundle was refused. */
  disclosure?: Disclosure
  /** Why the organization's bundle is not being run: unsigned, or not signed by the organization. */
  refused?: string
  /**
   * It could not be read at all — unreachable, missing, corrupt. What went
   * wrong is logged here, not told to whoever asks: it can name private paths
   * and URLs.
   */
  unavailable?: true
}

/**
 * The policy in force, for showing to the people it governs. Reading it asks
 * nothing of the policy, so it can be read even when the policy is refused
 * and nothing else can be decided.
 */
export const currentPolicy = async (): Promise<PolicyState> => {
  const running = current()
  if (running.engine === 'builtin') return { engine: 'builtin', disclosure: BUILT_IN }
  try {
    const disclosure = await running.disclose()
    return { engine: running.engine, disclosure }
  } catch (error) {
    // Refusing it is the organization's key speaking, which anyone may hear.
    if (error instanceof BundleRejectedError) return { engine: running.engine, refused: error.message }
    console.error('[id] the policy could not be read', error)
    return { engine: running.engine, unavailable: true }
  }
}

/**
 * A revision of the organization's policy this service has run, for reading
 * a past decision beside the rules that made it. Each is kept as soon as it
 * is first loaded.
 */
export const pastPolicy = async (revision: string): Promise<PolicyState | undefined> => {
  if (revision === 'builtin') return { engine: 'builtin', disclosure: BUILT_IN }
  const found = await revisions.find(revision)
  if (!found) return undefined
  const { firstUsedAt, ...disclosure } = found
  return { engine: 'bundle', disclosure, firstUsedAt }
}
