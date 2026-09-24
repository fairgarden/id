import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigError, parseServices } from '@fairgarden-private/id/lib/server/config'

describe('parseServices', () => {
  it('names a service after its variables, and fills in its URLs', () => {
    const [service] = parseServices({
      FG_ID_SERVICE_EVENT_TICKETS_URL: 'https://tickets.example.com/',
      FG_ID_SERVICE_EVENT_TICKETS_SECRET: 's3cret',
    })
    expect(service).toMatchObject({
      id: 'event-tickets',
      name: 'Event Tickets',
      url: 'https://tickets.example.com',
      secret: 's3cret',
      redirectUris: ['https://tickets.example.com/auth/callback'],
      postLogoutRedirectUris: ['https://tickets.example.com'],
      claims: {},
      claimsEndpoint: undefined,
    })
  })

  it('takes what it is given over the defaults', () => {
    const [service] = parseServices({
      FG_ID_SERVICE_APP_REDIRECT_URIS: 'com.example.app:/callback https://app.example.com/cb',
      FG_ID_SERVICE_APP_ID: 'native-app',
      FG_ID_SERVICE_APP_NAME: 'The App',
      FG_ID_SERVICE_APP_METADATA: '{"application_type":"native"}',
    })
    expect(service).toMatchObject({
      id: 'native-app',
      name: 'The App',
      url: undefined,
      secret: undefined,
      redirectUris: ['com.example.app:/callback', 'https://app.example.com/cb'],
      postLogoutRedirectUris: [],
      metadata: { application_type: 'native' },
    })
  })

  it('reads the scopes a service supplies claims for', () => {
    const [service] = parseServices({
      FG_ID_SERVICE_MEMBERS_URL: 'https://members.example.com',
      FG_ID_SERVICE_MEMBERS_CLAIMS: 'membership club:club_level,club_since',
    })
    expect(service.claims).toEqual({
      membership: ['membership'],
      club: ['club_level', 'club_since'],
    })
    expect(service.claimsEndpoint).toBe('https://members.example.com/api/v1alpha1/claimsreviews')
  })

  it.each([
    [{ FG_ID_SERVICE_X_URL: 'https://x.test', FG_ID_SERVICE_X_CLAIMS: 'profile' }, /answers for itself/],
    [{ FG_ID_SERVICE_X_URL: 'https://x.test', FG_ID_SERVICE_X_CLAIMS: 'extra:email' }, /issues itself/],
    [{ FG_ID_SERVICE_X_REDIRECT_URIS: 'https://x.test/cb', FG_ID_SERVICE_X_CLAIMS: 'extra' }, /needs a URL or CLAIMS_ENDPOINT/],
    [{ FG_ID_SERVICE_X_URL: 'https://x.test', FG_ID_SERVICE_X_METADATA: '[1]' }, /JSON object/],
    [
      {
        FG_ID_SERVICE_A_URL: 'https://a.test',
        FG_ID_SERVICE_A_CLAIMS: 'shared',
        FG_ID_SERVICE_B_URL: 'https://b.test',
        FG_ID_SERVICE_B_CLAIMS: 'shared',
      },
      /More than one service supplies/,
    ],
    [{ FG_ID_SERVICE_FG_ID_ACCOUNT_URL: 'https://x.test' }, /reserved ID/],
  ])('refuses a service it cannot serve: %j', (env, message) => {
    expect(() => parseServices(env)).toThrow(ConfigError)
    expect(() => parseServices(env)).toThrow(message)
  })
})

describe('getConfig', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    vi.resetModules()
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('FG_ID_') || key.startsWith('FG_POLICY_') || key.startsWith('VERCEL') || key === 'MONOLITH_MOUNTS') {
        delete process.env[key]
      }
    }
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  const load = async () => (await import('@fairgarden-private/id/lib/server/config')).getConfig()

  it('puts a monolith mount point into the issuer', async () => {
    process.env.FG_ID_URL = 'https://example.com/'
    process.env.MONOLITH_MOUNTS = JSON.stringify({ '@fairgarden-private/id': '/id' })
    const config = await load()
    expect(config.issuer).toBe('https://example.com/id')
    expect(config.origin).toBe('https://example.com')
    expect(config.passkeys.rpId).toBe('example.com')
  })

  it('falls back to the Vercel deployment, then to localhost', async () => {
    process.env.VERCEL_URL = 'id-abc123.vercel.app'
    expect((await load()).issuer).toBe('https://id-abc123.vercel.app')
    vi.resetModules()
    delete process.env.VERCEL_URL
    expect((await load()).issuer).toBe('http://localhost:3010')
  })

  it('only mocks email on a local host, unless told to', async () => {
    expect((await load()).email.mock).toBe(true)

    vi.resetModules()
    process.env.FG_ID_URL = 'https://id.example.com'
    expect((await load()).email.mock).toBe(false)

    vi.resetModules()
    process.env.FG_ID_MOCK_EMAIL = 'true'
    expect((await load()).email.mock).toBe(true)

    vi.resetModules()
    process.env.FG_ID_SMTP_URL = 'smtp://mail.example.com'
    expect((await load()).email.mock).toBe(false)
  })

  it('reads signing keys as JSON or base64url JSON, and needs their private part', async () => {
    const jwks = { keys: [{ kty: 'RSA', kid: 'k1', n: 'n', e: 'AQAB', d: 'd' }] }
    process.env.FG_ID_JWKS = Buffer.from(JSON.stringify(jwks)).toString('base64url')
    expect((await load()).keys.jwks?.keys[0].kid).toBe('k1')

    vi.resetModules()
    process.env.FG_ID_JWKS = JSON.stringify({ keys: [{ kty: 'RSA', kid: 'k1', n: 'n', e: 'AQAB' }] })
    await expect(load()).rejects.toThrow(/private part/)
  })

  it("takes the organization's policy from the settings every service shares", async () => {
    process.env.FG_POLICY_BUNDLE = 'none'
    expect((await load()).policy).toEqual({ source: undefined, package: 'fairgarden/id' })

    vi.resetModules()
    delete process.env.FG_POLICY_BUNDLE
    process.env.FG_POLICY_OPA_URL = 'http://opa:8181'
    expect((await load()).policy).toEqual({ source: { engine: 'server', url: 'http://opa:8181' }, package: 'fairgarden/id' })

    vi.resetModules()
    delete process.env.FG_POLICY_OPA_URL
    process.env.FG_POLICY_BUNDLE = 'policies.tar.gz'
    process.env.FG_POLICY_PUBLIC_KEY = '{"kty":"EC"}'
    process.env.FG_ID_POLICY_PACKAGE = 'acme.id'
    expect((await load()).policy).toEqual({
      source: { engine: 'bundle', source: 'policies.tar.gz', publicKey: '{"kty":"EC"}' },
      package: 'acme/id',
    })
  })

  it('refuses a bundle it has no key to check', async () => {
    process.env.FG_POLICY_BUNDLE = 'policies.tar.gz'
    await expect(load()).rejects.toThrow(/FG_POLICY_PUBLIC_KEY/)
  })
})
