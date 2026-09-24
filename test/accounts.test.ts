import { describe, expect, it } from 'vitest'
import {
  accountClaims,
  findOrCreateAccountByEmail,
  formatAddress,
  normalizeEmail,
  updateProfile,
} from '@fairgarden-private/id/lib/server/accounts'
import { db } from '@fairgarden-private/id/lib/server/db'
import { useDatabase } from './helpers/database'

describe('accounts', () => {
  useDatabase()

  it('normalizes email addresses, and refuses what is not one', () => {
    expect(normalizeEmail('  Person@Example.COM ')).toBe('person@example.com')
    expect(normalizeEmail('not an email')).toBeUndefined()
    expect(normalizeEmail(42)).toBeUndefined()
  })

  it('creates an account the first time an address is proven, and finds it after', async () => {
    const first = await findOrCreateAccountByEmail(await db(), 'someone@example.com')
    expect(first.created).toBe(true)
    expect(first.account.emailVerified).toBe(true)
    const again = await findOrCreateAccountByEmail(await db(), 'someone@example.com')
    expect(again).toMatchObject({ created: false, account: { id: first.account.id } })
  })

  it('formats an address from its parts', () => {
    expect(
      formatAddress({ street_address: '1 Garden Way\nFlat 2', locality: 'Leafton', region: 'Greens', postal_code: '1234', country: 'NZ' })
        .formatted
    ).toBe('1 Garden Way\nFlat 2\nLeafton Greens 1234\nNZ')
  })

  it('releases only what is filled in, and never says a phone number is verified', async () => {
    const { account } = await findOrCreateAccountByEmail(await db(), 'claims@example.com')
    expect(accountClaims(account)).toEqual({
      sub: account.id,
      email: 'claims@example.com',
      email_verified: true,
      updated_at: expect.any(Number),
    })
    const updated = await updateProfile(await db(), account.id, {
      name: 'Claims Person',
      phoneNumber: '+64 21 000 000',
      address: formatAddress({ locality: 'Leafton' }),
    })
    expect(accountClaims(updated)).toMatchObject({
      name: 'Claims Person',
      phone_number: '+64 21 000 000',
      phone_number_verified: false,
      address: { locality: 'Leafton', formatted: 'Leafton' },
    })
    expect(accountClaims(updated)).not.toHaveProperty('residential_address')
  })
})
