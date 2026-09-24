import { sql } from 'drizzle-orm'
import { decisionLogTable, revisionTable } from '@fairgarden/policy/drizzle'
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * The database, as Drizzle sees it. `pnpm db:generate` diffs this against the
 * last migration in `drizzle/` and writes the next one.
 *
 * Every table is prefixed `id_` so this can share a database with the other
 * services; one Neon database for a whole deployment is fine. Kept free of
 * imports from the rest of the app, because drizzle-kit loads it on its own.
 */

/** The OIDC `address` claim, as stored. */
export interface StoredAddress {
  formatted?: string
  street_address?: string
  locality?: string
  region?: string
  postal_code?: string
  country?: string
}

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const accounts = pgTable(
  'id_accounts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name'),
    phoneNumber: text('phone_number'),
    address: jsonb('address').$type<StoredAddress>(),
    residentialAddress: jsonb('residential_address').$type<StoredAddress>(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('id_accounts_email').on(sql`lower(${table.email})`)]
)

export const passkeys = pgTable(
  'id_passkeys',
  {
    /** The credential ID, base64url. */
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** COSE public key, base64url. */
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: jsonb('transports').$type<string[]>().notNull().default([]),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [index('id_passkeys_account').on(table.accountId)]
)

/** WebAuthn challenges, each used once. */
export const challenges = pgTable('id_challenges', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

/** Sign-in emails: a link and a code, both bound to the sign-in that asked. */
export const emailCodes = pgTable(
  'id_email_codes',
  {
    /** SHA-256 of the link's token. */
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    interactionUid: text('interaction_uid').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('id_email_codes_interaction').on(table.interactionUid, table.createdAt.desc()),
    index('id_email_codes_email').on(sql`lower(${table.email})`, table.createdAt.desc()),
  ]
)

/** oidc-provider's models: sessions, grants, codes, tokens and interactions. */
export const oidc = pgTable(
  'id_oidc',
  {
    type: text('type').notNull(),
    id: text('id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    grantId: text('grant_id'),
    userCode: text('user_code'),
    uid: text('uid'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.type, table.id] }),
    index('id_oidc_grant').on(table.grantId).where(sql`${table.grantId} is not null`),
    index('id_oidc_uid').on(table.uid).where(sql`${table.uid} is not null`),
    index('id_oidc_user_code').on(table.userCode).where(sql`${table.userCode} is not null`),
    index('id_oidc_expires').on(table.expiresAt).where(sql`${table.expiresAt} is not null`),
    index('id_oidc_grant_account')
      .on(sql`(${table.payload} ->> 'accountId')`)
      .where(sql`${table.type} = 'Grant'`),
  ]
)

/** Token signing keys (`sig`) and cookie secrets (`cookie`), when not set by environment. */
export const keys = pgTable(
  'id_keys',
  {
    kid: text('kid').primaryKey(),
    use: text('use').$type<'sig' | 'cookie'>().notNull(),
    material: jsonb('material').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('id_keys_use').on(table.use, table.createdAt.desc())]
)

/** What the mock email transport sent, for reading locally. */
export const mockMessages = pgTable('id_mock_messages', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  to: text('to_address').notNull(),
  subject: text('subject').notNull(),
  text: text('text_body').notNull(),
  html: text('html_body').notNull(),
  createdAt: createdAt(),
})

/** Every authorization decision, as Open Policy Agent logs its own, for audits. */
export const policyDecisions = decisionLogTable('id_policy_decisions')

/** Every revision of the organization's policy this service has run, so each decision can be read beside its rules. */
export const policyRevisions = revisionTable('id_policy_revisions')
