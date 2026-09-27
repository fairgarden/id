import Provider from 'oidc-provider'
import { describe, expect, it } from 'vitest'
import { acceptPreviousSecrets } from '@fairgarden/id/lib/server/provider'
import { parseServices } from '@fairgarden/id/lib/server/config'

describe('a rotated client secret', () => {
  it('is still accepted until the next rotation drops it, and nothing else is', async () => {
    const services = parseServices({
      FG_ID_SERVICE_MEMBERS_URL: 'https://members.example.com',
      FG_ID_SERVICE_MEMBERS_SECRET: 'newest older',
    })
    const provider = new Provider('https://id.example.com', {
      clients: [
        {
          client_id: 'members',
          client_secret: services[0].secret,
          redirect_uris: services[0].redirectUris,
          token_endpoint_auth_method: 'client_secret_basic',
        },
      ],
    })
    acceptPreviousSecrets(provider, services)
    const client = (await provider.Client.find('members'))!
    expect(await client.compareClientSecret('newest')).toBe(true)
    expect(await client.compareClientSecret('older')).toBe(true)
    expect(await client.compareClientSecret('oldest')).toBe(false)
  })
})
