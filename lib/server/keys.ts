import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { and, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import { getConfig, type JsonWebKeyWithKid } from './config.ts'
import type { Database, Executor } from './db.ts'
import { keys } from './schema.ts'

/**
 * Signing keys for tokens and secrets for cookies, and their rotation.
 *
 * By default both live in the database and rotate on their own: a new key is
 * created every `FG_ID_KEY_ROTATION_DAYS` (30), published for a day before it
 * signs anything so services that cache the JWKS pick it up first, and kept
 * for two more rotations after it stops signing so tokens it issued still
 * verify. Nothing has to be redeployed.
 *
 * `FG_ID_JWKS` and `FG_ID_COOKIE_SECRETS` take over from the database for a
 * deployment that wants its keys in its secret store. Then the first key or
 * secret signs, every one of them verifies, and `pnpm keys rotate --env`
 * prints the next value to set.
 */

export interface KeySet {
  /** Private JWKs, the one that signs first. */
  jwks: { keys: JsonWebKeyWithKid[] }
  /** Cookie secrets, the one that signs first. */
  cookieKeys: string[]
  /** Changes whenever either list does. */
  version: string
}

type Use = 'sig' | 'cookie'

interface KeyRow {
  kid: string
  material: Record<string, unknown>
  createdAt: Date
}

/** How many keys to keep: the one signing, the one after it, and one before. */
const KEEP = 3
const DAY = 24 * 60 * 60 * 1000
const LOCK = 7_031_000_002

const timestamp = (date = new Date()): string =>
  date.toISOString().slice(0, 10).replace(/-/g, '')

/** An RS256 key: what every OIDC client can verify without being configured. */
export const generateSigningKey = (): JsonWebKeyWithKid => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = privateKey.export({ format: 'jwk' }) as JsonWebKey
  return {
    ...jwk,
    kid: `${timestamp()}-${randomBytes(4).toString('hex')}`,
    alg: 'RS256',
    use: 'sig',
  }
}

export const generateCookieSecret = (): string => randomBytes(32).toString('base64url')

/** Keys without `use` or `alg` would rank below ones with them; say what they are. */
const normalize = (key: JsonWebKeyWithKid): JsonWebKeyWithKid => {
  const alg =
    key.alg ??
    (key.kty === 'RSA'
      ? 'RS256'
      : key.kty === 'EC' && key.crv === 'P-256'
        ? 'ES256'
        : key.kty === 'OKP' && key.crv === 'Ed25519'
          ? 'EdDSA'
          : undefined)
  return { ...key, use: key.use ?? 'sig', ...(alg ? { alg } : {}) }
}

const listKeys = (database: Executor, use: Use): Promise<KeyRow[]> =>
  database
    .select({ kid: keys.kid, material: keys.material, createdAt: keys.createdAt })
    .from(keys)
    .where(eq(keys.use, use))
    .orderBy(desc(keys.createdAt), desc(keys.kid))

const ageOf = (row: KeyRow, now: number): number => now - row.createdAt.getTime()

/**
 * Put the key that signs first: the newest one that has been published long
 * enough, or, before any has, the oldest there is.
 */
const order = (rows: KeyRow[], rotationDays: number, now: number): KeyRow[] => {
  const prepublish = Math.min(DAY, (rotationDays * DAY) / 2)
  const active = rows.find((row) => ageOf(row, now) >= prepublish) ?? rows[rows.length - 1]
  return active ? [active, ...rows.filter((row) => row !== active)] : []
}

/**
 * Create the next key when the newest is due, keeping only the last few.
 * Returns the keys, and the one it created, if it did.
 */
const rotate = async (
  database: Database,
  use: Use,
  rotationDays: number,
  { force = false } = {}
): Promise<{ rows: KeyRow[]; created?: string }> => {
  const now = Date.now()
  const due = (rows: KeyRow[]) =>
    force || rows.length === 0 || ageOf(rows[0], now) >= rotationDays * DAY

  const rows = await listKeys(database, use)
  if (!due(rows)) return { rows }

  return database.transaction(async (tx) => {
    // Every instance may notice at once; only one should create the key.
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`)
    const current = await listKeys(tx, use)
    if (!due(current)) return { rows: current }

    const material = (
      use === 'sig' ? generateSigningKey() : { secret: generateCookieSecret() }
    ) as Record<string, unknown>
    const kid =
      typeof material.kid === 'string'
        ? material.kid
        : `${timestamp()}-${randomBytes(4).toString('hex')}`
    await tx.insert(keys).values({ kid, use, material })

    // The new key, and the newest of the others; never the new one, whatever
    // the clock says.
    const kept = tx
      .select({ kid: keys.kid })
      .from(keys)
      .where(and(eq(keys.use, use), ne(keys.kid, kid)))
      .orderBy(desc(keys.createdAt), desc(keys.kid))
      .limit(KEEP - 1)
    await tx
      .delete(keys)
      .where(and(eq(keys.use, use), ne(keys.kid, kid), notInArray(keys.kid, kept)))
    return { rows: await listKeys(tx, use), created: kid }
  })
}

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('base64url').slice(0, 12)

export const loadKeys = async (database: Database): Promise<KeySet> => {
  const { keys: settings } = getConfig()
  const now = Date.now()

  const signing = settings.jwks
    ? settings.jwks.keys.map(normalize)
    : order((await rotate(database, 'sig', settings.rotationDays)).rows, settings.rotationDays, now).map(
        (row) => row.material as unknown as JsonWebKeyWithKid
      )

  const cookieRows = settings.cookieSecrets
    ? undefined
    : order((await rotate(database, 'cookie', settings.rotationDays)).rows, settings.rotationDays, now)
  const cookieKeys =
    settings.cookieSecrets ?? cookieRows!.map((row) => String(row.material.secret))

  return {
    jwks: { keys: signing },
    cookieKeys,
    version: [
      ...signing.map((key) => key.kid),
      ...(cookieRows ? cookieRows.map((row) => row.kid) : cookieKeys.map(hash)),
    ].join(','),
  }
}

/**
 * Start signing with a new key now rather than when rotation is due, for a
 * key that may have leaked. The old one keeps verifying until it ages out,
 * unless `retire` removes it immediately.
 */
export const rotateNow = async (
  database: Database,
  { retire = false }: { retire?: boolean } = {}
): Promise<{ kid: string; retired: string[] }> => {
  const { keys: settings } = getConfig()
  const before = await listKeys(database, 'sig')
  const { created } = await rotate(database, 'sig', settings.rotationDays, { force: true })
  const kid = created!
  // Backdate it past the publishing delay so it signs straight away, and the
  // others with it so it stays the newest.
  await database.transaction(async (tx) => {
    await tx
      .update(keys)
      .set({ createdAt: sql`${keys.createdAt} - interval '2 days'` })
      .where(and(eq(keys.use, 'sig'), ne(keys.kid, kid)))
    await tx
      .update(keys)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(eq(keys.kid, kid))
  })
  const retired = retire ? before.map((row) => row.kid).filter((old) => old !== kid) : []
  if (retired.length > 0) await database.delete(keys).where(inArray(keys.kid, retired))
  return { kid, retired }
}

export const describeKeys = async (
  database: Database
): Promise<Array<{ kid: string; use: Use; createdAt: Date; signing: boolean }>> => {
  const { keys: settings } = getConfig()
  const now = Date.now()
  const result = []
  for (const use of ['sig', 'cookie'] as const) {
    const ordered = order(await listKeys(database, use), settings.rotationDays, now)
    for (const [index, row] of ordered.entries()) {
      result.push({ kid: row.kid, use, createdAt: row.createdAt, signing: index === 0 })
    }
  }
  return result
}
