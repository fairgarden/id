import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createPublicKey } from 'node:crypto'
import { jwtVerify, type JWTHeaderParameters, type JWTPayload } from 'jose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ClaimsReview } from '@fairgarden/id/lib/api/schemas'
import { generateSigningKey } from '@fairgarden/id/lib/server/keys'

/**
 * A service that supplies the `club` scope, answering ClaimsReviews the way
 * apps/members does, and recording what it was sent.
 */
const signingJwk = generateSigningKey()
const received: Array<{
  review: ClaimsReview
  token: { payload: JWTPayload; protectedHeader: JWTHeaderParameters }
}> = []
let behaviour: 'answer' | 'wrong-uid' | 'fail' = 'answer'

const server = http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const review = JSON.parse(body) as ClaimsReview
  const token = await jwtVerify(
    req.headers.authorization!.slice('Bearer '.length),
    createPublicKey({ key: signingJwk, format: 'jwk' }),
    { typ: 'fg-claims-review+jwt', audience: 'club' }
  )
  received.push({ review, token })
  if (behaviour === 'fail') {
    res.statusCode = 500
    return res.end()
  }
  res.setHeader('content-type', 'application/json')
  res.end(
    JSON.stringify({
      apiVersion: 'id.fairgarden.org/v1alpha1',
      kind: 'ClaimsReview',
      response: {
        uid: behaviour === 'wrong-uid' ? 'someone-else' : review.request!.uid,
        // `email` is not the club's to give, and must be dropped.
        claims: { club: { level: 'gold' }, email: 'forged@example.com' },
        reasons: { 'club.handicap': 'Handicaps stay in the clubhouse.' },
      },
    })
  )
})

const load = () => import('@fairgarden/id/lib/server/claims')

describe('claims from another service', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    process.env.FG_ID_URL = 'http://localhost:3010'
    process.env.FG_ID_SERVICE_CLUB_URL = `http://127.0.0.1:${port}/club`
    process.env.FG_ID_SERVICE_CLUB_CLAIMS = 'club'
  })
  afterAll(() => {
    server.close()
  })

  const ask = async (scopes: string[], purpose: 'Release' | 'Preview' = 'Release') =>
    (await load()).fetchDelegatedClaims({
      subject: 'account-1',
      client: { id: 'events', name: 'Events' },
      scopes: new Set(scopes),
      purpose,
      signingJwk,
    })

  it('asks only when one of its scopes is wanted', async () => {
    expect(await ask(['openid', 'email'])).toEqual({ claims: {}, reasons: {} })
    expect(received).toHaveLength(0)
  })

  it('sends a signed review, and keeps only the claims its scopes carry', async () => {
    expect(await ask(['openid', 'club'], 'Preview')).toEqual({
      claims: { club: { level: 'gold' } },
      reasons: { 'club.handicap': 'Handicaps stay in the clubhouse.' },
    })
    const [{ review, token }] = received
    expect(review.request).toMatchObject({
      subject: 'account-1',
      purpose: 'Preview',
      client: { id: 'events', name: 'Events' },
      scopes: ['club'],
      claims: ['club'],
    })
    expect(token.payload).toMatchObject({ iss: 'http://localhost:3010', sub: 'account-1', jti: review.request!.uid })
    expect(token.protectedHeader.kid).toBe(signingJwk.kid)
  })

  it('leaves the claims out, rather than failing, when the service does not answer properly', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    behaviour = 'wrong-uid'
    expect(await ask(['club'])).toEqual({ claims: {}, reasons: {} })
    behaviour = 'fail'
    expect(await ask(['club'])).toEqual({ claims: {}, reasons: {} })
    behaviour = 'answer'
  })
})
