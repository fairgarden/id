import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Executor } from './db.ts'
import { accounts, passkeys, type StoredAddress } from './schema.ts'

/**
 * People, and the little this service knows about them.
 *
 * This holds what is sensitive or has to be verified — the email address,
 * phone number and addresses — so each person decides, service by service,
 * who sees it. Everything else about them belongs to the services
 * themselves; the members service is where a profile is filled in.
 */

export type Account = typeof accounts.$inferSelect
export type Passkey = typeof passkeys.$inferSelect
export type { StoredAddress }

export const normalizeEmail = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined
  return email
}

export const findAccount = async (
  database: Executor,
  id: string
): Promise<Account | undefined> => {
  const [account] = await database.select().from(accounts).where(eq(accounts.id, id))
  return account
}

/** Proving an email address is how an account comes to exist. */
export const findOrCreateAccountByEmail = async (
  database: Executor,
  email: string
): Promise<{ account: Account; created: boolean }> => {
  const [created] = await database
    .insert(accounts)
    .values({ id: randomUUID(), email, emailVerified: true })
    .onConflictDoNothing()
    .returning()
  if (created) return { account: created, created: true }

  const [account] = await database
    .update(accounts)
    .set({ emailVerified: true })
    .where(sql`lower(${accounts.email}) = lower(${email})`)
    .returning()
  return { account, created: false }
}

export interface ProfileUpdate {
  name?: string | null
  phoneNumber?: string | null
  address?: StoredAddress | null
  residentialAddress?: StoredAddress | null
}

export const updateProfile = async (
  database: Executor,
  id: string,
  update: ProfileUpdate
): Promise<Account> => {
  const [account] = await database
    .update(accounts)
    .set({ ...update, updatedAt: sql`now()` })
    .where(eq(accounts.id, id))
    .returning()
  return account
}

/** Derive the `formatted` line of an address from its parts. */
export const formatAddress = (address: StoredAddress): StoredAddress => {
  const cityLine = [address.locality, address.region, address.postal_code]
    .filter(Boolean)
    .join(' ')
  return {
    ...address,
    formatted: [address.street_address, cityLine, address.country].filter(Boolean).join('\n'),
  }
}

/** Every claim this account could release; the provider keeps what was granted. */
export const accountClaims = (account: Account): { sub: string; [claim: string]: unknown } => ({
  sub: account.id,
  email: account.email,
  email_verified: account.emailVerified,
  ...(account.name ? { name: account.name } : {}),
  updated_at: Math.floor(account.updatedAt.getTime() / 1000),
  ...(account.phoneNumber
    ? { phone_number: account.phoneNumber, phone_number_verified: false }
    : {}),
  ...(account.address ? { address: account.address } : {}),
  ...(account.residentialAddress ? { residential_address: account.residentialAddress } : {}),
})

export const listPasskeys = (database: Executor, accountId: string): Promise<Passkey[]> =>
  database
    .select()
    .from(passkeys)
    .where(eq(passkeys.accountId, accountId))
    .orderBy(asc(passkeys.createdAt))

export const findPasskey = async (
  database: Executor,
  id: string
): Promise<Passkey | undefined> => {
  const [passkey] = await database.select().from(passkeys).where(eq(passkeys.id, id))
  return passkey
}

export const addPasskey = async (
  database: Executor,
  passkey: typeof passkeys.$inferInsert
): Promise<Passkey> => {
  const [created] = await database.insert(passkeys).values(passkey).returning()
  return created
}

export const recordPasskeyUse = async (
  database: Executor,
  id: string,
  counter: number,
  backedUp: boolean
): Promise<void> => {
  await database
    .update(passkeys)
    .set({ counter, backedUp, lastUsedAt: sql`now()` })
    .where(eq(passkeys.id, id))
}

export const renamePasskey = async (
  database: Executor,
  accountId: string,
  id: string,
  name: string
): Promise<Passkey | undefined> => {
  const [passkey] = await database
    .update(passkeys)
    .set({ name })
    .where(and(eq(passkeys.id, id), eq(passkeys.accountId, accountId)))
    .returning()
  return passkey
}

export const deletePasskey = async (
  database: Executor,
  accountId: string,
  id: string
): Promise<boolean> => {
  const deleted = await database
    .delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.accountId, accountId)))
    .returning({ id: passkeys.id })
  return deleted.length > 0
}
