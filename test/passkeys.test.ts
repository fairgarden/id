import { beforeAll, describe, expect, it } from 'vitest'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { findOrCreateAccountByEmail, listPasskeys, type Account } from '@fairgarden/id/lib/server/accounts'
import { db } from '@fairgarden/id/lib/server/db'
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from '@fairgarden/id/lib/server/passkeys'
import { SoftwareAuthenticator } from './helpers/authenticator'
import { useDatabase } from './helpers/database'

const ORIGIN = 'http://localhost:3010'

describe('passkeys', () => {
  useDatabase()
  let account: Account
  const device = new SoftwareAuthenticator(ORIGIN)

  const register = async (authenticator = device) => {
    const { options } = await registrationOptions(await db(), 'register', account)
    const credential = authenticator.create(options as unknown as Record<string, unknown>)
    return verifyRegistration(await db(), 'register', account, credential as unknown as RegistrationResponseJSON, {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    })
  }

  const signIn = async (authenticator = device) => {
    const { options } = await authenticationOptions(await db(), 'login')
    const assertion = authenticator.get(options as unknown as Record<string, unknown>)
    return verifyAuthentication(await db(), 'login', assertion as unknown as AuthenticationResponseJSON)
  }

  beforeAll(async () => {
    ;({ account } = await findOrCreateAccountByEmail(await db(), 'passkeys@example.com'))
  })

  it('registers a discoverable passkey, named for the device', async () => {
    const passkey = await register()
    expect(passkey).toMatchObject({
      accountId: account.id,
      deviceType: 'multiDevice',
      backedUp: true,
      name: 'Passkey synced from Mac',
      counter: 0,
    })
    expect(await listPasskeys(await db(), account.id)).toHaveLength(1)
  })

  it('signs in with it, without being told who is signing in', async () => {
    const { passkey, userVerified } = await signIn()
    expect(passkey.accountId).toBe(account.id)
    expect(userVerified).toBe(true)
    const [stored] = await listPasskeys(await db(), account.id)
    expect(stored.counter).toBe(1)
    expect(stored.lastUsedAt).toBeInstanceOf(Date)
  })

  it('takes each challenge once', async () => {
    const { options } = await authenticationOptions(await db(), 'login')
    const assertion = device.get(options as unknown as Record<string, unknown>)
    await verifyAuthentication(await db(), 'login', assertion as unknown as AuthenticationResponseJSON)
    await expect(
      verifyAuthentication(await db(), 'login', assertion as unknown as AuthenticationResponseJSON)
    ).rejects.toMatchObject({ code: 410 })
  })

  it('refuses a passkey it does not know', async () => {
    await expect(signIn(new SoftwareAuthenticator(ORIGIN).withCredentialFrom(device, 'forged'))).rejects.toMatchObject({
      code: 404,
    })
  })

  it('refuses one made for another site', async () => {
    await expect(register(new SoftwareAuthenticator('https://evil.example'))).rejects.toMatchObject({ code: 400 })
  })

  it('tells the browser what is registered, and refuses a replayed registration', async () => {
    const { options } = await registrationOptions(await db(), 'register', account)
    const first = device.create(options as unknown as Record<string, unknown>)
    await verifyRegistration(await db(), 'register', account, first as unknown as RegistrationResponseJSON, {})
    const again = await registrationOptions(await db(), 'register', account)
    // Browsers would refuse, given excludeCredentials; the server must too.
    expect((again.options.excludeCredentials ?? []).map((credential) => credential.id)).toContain(first.id)
    // Answering the new challenge with the old response fails verification.
    await expect(
      verifyRegistration(await db(), 'register', account, first as unknown as RegistrationResponseJSON, {})
    ).rejects.toMatchObject({ code: 400 })
  })
})
