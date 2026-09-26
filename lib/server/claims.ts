import { randomUUID } from 'node:crypto'
import { importJWK, SignJWT, type CryptoKey, type KeyObject } from 'jose'
import { GROUP_VERSION } from '@fairgarden/id/lib/api/group'
import type { ClaimsReview } from '@fairgarden/id/lib/api/schemas'
import { getConfig, type JsonWebKeyWithKid, type Service } from './config.ts'

/**
 * Claims that another service keeps, fetched when they are released.
 *
 * A service enrolled with `FG_ID_SERVICE_<NAME>_CLAIMS` owns some scopes; the
 * members service owns `membership`, say. When a person lets a third service
 * — events, perhaps — have that scope, this sends the owner a `ClaimsReview`
 * webhook, much as Kubernetes sends an AdmissionReview, and passes on what it
 * answers. Nothing is copied here, so the owner stays the only source.
 *
 * The request carries a bearer JWT signed with this service's current token
 * key, typed `fg-claims-review+jwt` so it can never pass for an ID token.
 * The owner checks it against the JWKS in this service's discovery document,
 * and checks `jti` and `sub` against the body.
 */

export const CLAIMS_REVIEW_JWT_TYPE = 'fg-claims-review+jwt'
const TIMEOUT_MS = 3_000

const imported = new Map<string, Promise<CryptoKey | KeyObject | Uint8Array>>()
const signingKey = (jwk: JsonWebKeyWithKid) => {
  if (!imported.has(jwk.kid)) imported.set(jwk.kid, importJWK(jwk, jwk.alg ?? 'RS256'))
  return imported.get(jwk.kid)!
}

export interface ClaimsRequest {
  subject: string
  client: { id: string; name: string }
  scopes: Set<string>
  purpose: 'Release' | 'Preview'
  /** The key tokens are signed with right now. */
  signingJwk: JsonWebKeyWithKid
}

export interface DelegatedClaims {
  claims: Record<string, unknown>
  /** What each service withheld, and why, keyed by what it withheld. */
  reasons: Record<string, string>
}

const NONE: DelegatedClaims = { claims: {}, reasons: {} }

const review = async (
  service: Service,
  scopes: string[],
  { subject, client, purpose, signingJwk }: ClaimsRequest
): Promise<DelegatedClaims> => {
  const claims = [...new Set(scopes.flatMap((scope) => service.claims[scope] ?? []))]
  const uid = randomUUID()
  const body: ClaimsReview = {
    apiVersion: GROUP_VERSION,
    kind: 'ClaimsReview',
    request: { uid, purpose, subject, client, scopes, claims },
  }
  const token = await new SignJWT({ scope: scopes.join(' ') })
    .setProtectedHeader({
      alg: signingJwk.alg ?? 'RS256',
      kid: signingJwk.kid,
      typ: CLAIMS_REVIEW_JWT_TYPE,
    })
    .setIssuer(getConfig().issuer)
    .setAudience(service.id)
    .setSubject(subject)
    .setJti(uid)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(await signingKey(signingJwk))

  try {
    const response = await fetch(service.claimsEndpoint!, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`${service.claimsEndpoint} answered ${response.status}`)
    const answer = (await response.json()) as ClaimsReview
    if (answer.kind !== 'ClaimsReview' || answer.response?.uid !== uid) {
      throw new Error(`${service.claimsEndpoint} did not answer the ClaimsReview it was sent`)
    }
    return {
      // Only what those scopes carry, whatever else came back.
      claims: Object.fromEntries(
        Object.entries(answer.response.claims).filter(([name]) => claims.includes(name))
      ),
      reasons: answer.response.reasons ?? {},
    }
  } catch (error) {
    // A service being down should not stop people signing in elsewhere; the
    // claims are left out instead.
    console.warn(`[id] claims from ${service.name} unavailable:`, (error as Error).message)
    return NONE
  }
}

/** Ask each service that owns one of these scopes for its claims. */
export const fetchDelegatedClaims = async (request: ClaimsRequest): Promise<DelegatedClaims> => {
  const answers = await Promise.all(
    getConfig().services.map((service) => {
      const scopes = Object.keys(service.claims).filter((scope) => request.scopes.has(scope))
      return scopes.length > 0 && service.claimsEndpoint
        ? review(service, scopes, request)
        : Promise.resolve(NONE)
    })
  )
  return {
    claims: Object.assign({}, ...answers.map((answer) => answer.claims)),
    reasons: Object.assign({}, ...answers.map((answer) => answer.reasons)),
  }
}
