import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type pg from 'pg'

/**
 * Applies and rolls back the migrations in `drizzle/`.
 *
 * drizzle-kit writes each forward migration from the schema, and lists them
 * in `meta/_journal.json`, which is the order they run in. Rolling one back
 * runs the `<tag>.down.sql` beside it, written by hand; `pnpm db:generate`
 * leaves a stub to fill in. A migration without one cannot be rolled back.
 *
 * Every migration runs in its own transaction, under a lock, so two
 * deployments migrating at once take turns. What ran is recorded with a hash,
 * and a migration edited after it ran is refused rather than skipped.
 */

export interface Migration {
  tag: string
  up: string[]
  down: string[] | undefined
  hash: string
}

export interface MigrationStatus {
  tag: string
  state: 'applied' | 'pending' | 'edited' | 'unknown'
  appliedAt: Date | undefined
  reversible: boolean
}

const BREAKPOINT = '--> statement-breakpoint'
const TABLE = 'id_migrations'
const LOCK = 7_031_000_001

const statements = (sql: string): string[] =>
  sql
    .split(BREAKPOINT)
    .map((statement) => statement.trim())
    // A stub, or a chunk of nothing but comments, runs nothing.
    .filter((statement) => statement.replace(/--.*$/gm, '').trim().length > 0)

export const readMigrations = (directory: string): Migration[] => {
  const journal = JSON.parse(
    readFileSync(path.join(directory, 'meta', '_journal.json'), 'utf8')
  ) as { entries: Array<{ idx: number; tag: string }> }

  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => {
      const up = readFileSync(path.join(directory, `${tag}.sql`), 'utf8')
      const downFile = path.join(directory, `${tag}.down.sql`)
      const down = existsSync(downFile) ? statements(readFileSync(downFile, 'utf8')) : []
      return {
        tag,
        up: statements(up),
        down: down.length > 0 ? down : undefined,
        hash: createHash('sha256').update(up).digest('hex'),
      }
    })
}

interface AppliedRow {
  tag: string
  hash: string
  applied_at: Date
}

const withLock = async <T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK])
    try {
      await client.query(`
        create table if not exists ${TABLE} (
          tag text primary key,
          hash text not null,
          applied_at timestamptz not null default now()
        )
      `)
      return await fn(client)
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK])
    }
  } finally {
    client.release()
  }
}

const readApplied = async (client: pg.PoolClient): Promise<Map<string, AppliedRow>> => {
  const { rows } = await client.query<AppliedRow>(`select tag, hash, applied_at from ${TABLE}`)
  return new Map(rows.map((row) => [row.tag, row]))
}

const inTransaction = async (client: pg.PoolClient, fn: () => Promise<void>): Promise<void> => {
  await client.query('begin')
  try {
    await fn()
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}

export const status = (pool: pg.Pool, directory: string): Promise<MigrationStatus[]> =>
  withLock(pool, async (client) => {
    const migrations = readMigrations(directory)
    const applied = await readApplied(client)
    const known = new Set(migrations.map((migration) => migration.tag))
    return [
      ...migrations.map((migration): MigrationStatus => {
        const row = applied.get(migration.tag)
        return {
          tag: migration.tag,
          state: !row ? 'pending' : row.hash === migration.hash ? 'applied' : 'edited',
          appliedAt: row ? new Date(row.applied_at) : undefined,
          reversible: migration.down !== undefined,
        }
      }),
      ...[...applied.values()]
        .filter((row) => !known.has(row.tag))
        .map((row): MigrationStatus => ({
          tag: row.tag,
          state: 'unknown',
          appliedAt: new Date(row.applied_at),
          reversible: false,
        })),
    ]
  })

/** Apply every pending migration, in order. Returns the tags applied. */
export const migrate = (pool: pg.Pool, directory: string): Promise<string[]> =>
  withLock(pool, async (client) => {
    const migrations = readMigrations(directory)
    const applied = await readApplied(client)
    const known = new Set(migrations.map((migration) => migration.tag))

    const unknown = [...applied.keys()].filter((tag) => !known.has(tag))
    if (unknown.length > 0) {
      throw new Error(
        `The database has migrations this version does not know (${unknown.join(', ')}). ` +
          'Run a newer version, or roll them back with it first.'
      )
    }
    for (const migration of migrations) {
      const row = applied.get(migration.tag)
      if (row && row.hash !== migration.hash) {
        throw new Error(
          `${migration.tag} changed after it was applied. Revert the edit and add a new migration instead.`
        )
      }
    }

    const ran: string[] = []
    for (const migration of migrations.filter((migration) => !applied.has(migration.tag))) {
      await inTransaction(client, async () => {
        for (const statement of migration.up) await client.query(statement)
        await client.query(`insert into ${TABLE} (tag, hash) values ($1, $2)`, [
          migration.tag,
          migration.hash,
        ])
      })
      ran.push(migration.tag)
    }
    return ran
  })

/**
 * Roll back the latest migrations: one by default, `steps` of them, or every
 * one after `to`. Returns the tags rolled back, newest first.
 */
export const rollback = (
  pool: pg.Pool,
  directory: string,
  { steps, to }: { steps?: number; to?: string } = {}
): Promise<string[]> =>
  withLock(pool, async (client) => {
    const migrations = readMigrations(directory)
    const applied = await readApplied(client)
    const newestFirst = migrations.filter((migration) => applied.has(migration.tag)).reverse()

    let targets: Migration[]
    if (to !== undefined) {
      const index = newestFirst.findIndex((migration) => migration.tag === to)
      if (index === -1 && to !== '0') throw new Error(`${to} is not an applied migration`)
      targets = index === -1 ? newestFirst : newestFirst.slice(0, index)
    } else {
      targets = newestFirst.slice(0, steps ?? 1)
    }

    const irreversible = targets.filter((migration) => !migration.down)
    if (irreversible.length > 0) {
      throw new Error(
        `No down migration for ${irreversible.map((migration) => migration.tag).join(', ')}. ` +
          `Write drizzle/<tag>.down.sql first.`
      )
    }

    for (const migration of targets) {
      await inTransaction(client, async () => {
        for (const statement of migration.down!) await client.query(statement)
        await client.query(`delete from ${TABLE} where tag = $1`, [migration.tag])
      })
    }
    return targets.map((migration) => migration.tag)
  })
