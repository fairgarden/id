import { expect, test } from '@playwright/test'

test.describe('the API', () => {
  test('publishes its OIDC discovery document', async ({ request }) => {
    const discovery = await (await request.get('/.well-known/openid-configuration')).json()
    expect(discovery).toMatchObject({
      issuer: 'http://localhost:3110',
      authorization_endpoint: 'http://localhost:3110/oidc/auth',
      scopes_supported: expect.arrayContaining(['openid', 'phone', 'residential_address', 'club']),
      code_challenge_methods_supported: ['S256'],
    })
    const jwks = await (await request.get(discovery.jwks_uri)).json()
    expect(jwks.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' })
    expect(jwks.keys[0]).not.toHaveProperty('d')
  })

  test('is discoverable, Kubernetes style, with an OpenAPI document', async ({ request }) => {
    expect(await (await request.get('/api')).json()).toEqual({
      apiVersion: 'v1',
      kind: 'APIVersions',
      versions: ['v1alpha1'],
    })
    expect(await (await request.get('/api/v1alpha1')).json()).toMatchObject({ kind: 'APIResourceList' })
    const openapi = await (await request.get('/api/openapi/v3')).json()
    expect(openapi).toMatchObject({ openapi: '3.1.0', servers: [{ url: 'http://localhost:3110' }] })
  })

  test('answers every error with a Status', async ({ request }) => {
    const unauthorized = await request.get('/api/v1alpha1/accounts/me')
    expect(unauthorized.status()).toBe(401)
    expect(await unauthorized.json()).toMatchObject({ kind: 'Status', status: 'Failure', reason: 'Unauthorized' })

    const crossSite = await request.patch('/api/v1alpha1/accounts/me', {
      headers: { origin: 'https://evil.example', 'content-type': 'application/merge-patch+json' },
      data: { spec: { displayName: 'pwned' } },
    })
    expect(crossSite.status()).toBe(403)

    const gone = await request.get('/api/v1alpha1/interactions/nonexistent', { headers: { accept: 'application/json' } })
    expect(await gone.json()).toMatchObject({ kind: 'Status', code: 403 })
  })
})
