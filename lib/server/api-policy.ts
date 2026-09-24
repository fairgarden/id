import { GROUP_VERSION } from '@fairgarden-private/id/lib/api/group'
import * as api from '@fairgarden-private/id/lib/api/schemas'
import { defineRoute, type Route } from './api-route.ts'
import { ApiError } from './errors.ts'
import { currentPolicy, pastPolicy, type PolicyState } from './policy.ts'

/** The policy in force, as the API describes it. */
export const toApiPolicy = (
  { engine, disclosure, refused, unavailable, firstUsedAt }: PolicyState,
  name = 'current'
): api.Policy => ({
  apiVersion: GROUP_VERSION,
  kind: 'Policy',
  metadata: { name, ...(firstUsedAt ? { creationTimestamp: firstUsedAt.toISOString() } : {}) },
  spec: {
    engine,
    ...(disclosure && disclosure.revision !== 'builtin' ? { revision: disclosure.revision } : {}),
    ...(disclosure?.commit ? { commit: disclosure.commit } : {}),
    organization: disclosure?.organization ?? {},
    layers: disclosure?.layers ?? [],
    packages: disclosure?.packages ?? [],
    settings: disclosure?.data ?? {},
  },
  status: {
    phase: refused ? 'Refused' : unavailable ? 'Unavailable' : disclosure ? 'Active' : 'Undisclosed',
    ...(refused ? { message: refused } : {}),
    ...(unavailable ? { message: 'The policy could not be read. Nothing it decides can be done until it can.' } : {}),
    signature: disclosure?.signature ?? null,
  },
})

/**
 * Next decodes route params already; a name that still decodes was sent
 * encoded twice. One that does not — a stray `%` — is taken as it is.
 */
const decoded = (name: string) => {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

export const readPolicy = defineRoute({
  method: 'GET',
  path: 'policies/{name}',
  verb: 'get',
  operationId: 'readPolicy',
  summary: 'Read the policy in force, or one that was',
  description:
    '`current`, or a revision this service has run — the `revision` label on a PolicyDecision — to read a past decision beside the rules that made it. ' +
    'Anyone may read either, without asking the policy: it can be read even when it is refused, and it cannot hide itself.',
  security: 'none',
  responses: { 200: { description: 'The policy', schema: api.Policy } },
  async handle(context) {
    const name = decoded(context.params.name)
    if (name === 'current') return { status: 200, body: toApiPolicy(await currentPolicy()) }
    const past = await pastPolicy(name)
    if (!past) throw new ApiError(404, 'NotFound', `This service has never run revision ${name}.`)
    return { status: 200, body: toApiPolicy(past, name) }
  },
})

export const policyRoutes: Route[] = [readPolicy]
