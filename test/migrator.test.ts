import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, rollback, status } from '@fairgarden/id/lib/server/migrator'
import { ROOT, useDatabase } from './helpers/database'

/** A migrations folder shaped like drizzle-kit's. */
const folder = (migrations: Array<{ tag: string; up: string; down?: string }>) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'migrations-'))
  mkdirSync(path.join(directory, 'meta'))
  writeFileSync(
    path.join(directory, 'meta', '_journal.json'),
    JSON.stringify({ entries: migrations.map(({ tag }, idx) => ({ idx, tag })) })
  )
  for (const { tag, up, down } of migrations) {
    writeFileSync(path.join(directory, `${tag}.sql`), up)
    if (down !== undefined) writeFileSync(path.join(directory, `${tag}.down.sql`), down)
  }
  return directory
}

const tables = async (database: ReturnType<typeof useDatabase>) =>
  (
    await database.pool.query<{ name: string }>(
      `select table_name as name from information_schema.tables
       where table_schema = 'public' and table_name like 't\\_%' order by 1`
    )
  ).rows.map((row) => row.name)

describe('the migrator', () => {
  const database = useDatabase({ migrated: false })

  it('applies, reports and rolls back migrations in order', async () => {
    const directory = folder([
      { tag: '0000_a', up: 'create table t_a (id int);\n--> statement-breakpoint\ncreate table t_b (id int);', down: 'drop table t_b;\n--> statement-breakpoint\ndrop table t_a;' },
      { tag: '0001_c', up: 'create table t_c (id int);', down: 'drop table t_c;' },
    ])

    expect(await migrate(database.pool, directory)).toEqual(['0000_a', '0001_c'])
    expect(await migrate(database.pool, directory)).toEqual([])
    expect(await tables(database)).toEqual(['t_a', 't_b', 't_c'])
    expect((await status(database.pool, directory)).map((row) => row.state)).toEqual(['applied', 'applied'])

    expect(await rollback(database.pool, directory)).toEqual(['0001_c'])
    expect(await tables(database)).toEqual(['t_a', 't_b'])
    expect((await status(database.pool, directory)).map((row) => row.state)).toEqual(['applied', 'pending'])

    await migrate(database.pool, directory)
    expect(await rollback(database.pool, directory, { to: '0' })).toEqual(['0001_c', '0000_a'])
    expect(await tables(database)).toEqual([])
  })

  it('refuses a migration edited after it ran', async () => {
    const before = folder([{ tag: '0000_x', up: 'create table t_x (id int);', down: 'drop table t_x;' }])
    await migrate(database.pool, before)
    const after = folder([{ tag: '0000_x', up: 'create table t_x (id bigint);', down: 'drop table t_x;' }])
    expect((await status(database.pool, after))[0].state).toBe('edited')
    await expect(migrate(database.pool, after)).rejects.toThrow(/changed after it was applied/)
    await rollback(database.pool, before)
  })

  it('refuses to roll back without a down migration, and changes nothing', async () => {
    const directory = folder([
      { tag: '0000_y', up: 'create table t_y (id int);', down: 'drop table t_y;' },
      { tag: '0001_z', up: 'create table t_z (id int);', down: '-- nothing written yet\n' },
    ])
    await migrate(database.pool, directory)
    await expect(rollback(database.pool, directory, { steps: 2 })).rejects.toThrow(/No down migration for 0001_z/)
    expect(await tables(database)).toEqual(['t_y', 't_z'])
  })

  it('refuses to run against a database that is ahead of it', async () => {
    const older = folder([{ tag: '0000_y', up: 'create table t_y (id int);', down: 'drop table t_y;' }])
    await expect(migrate(database.pool, older)).rejects.toThrow(/does not know \(0001_z\)/)
  })

  it('applies and undoes the real migrations', async () => {
    const real = path.join(ROOT, 'drizzle')
    const fresh = useFreshSchema(database)
    await fresh()
    expect((await migrate(database.pool, real)).length).toBeGreaterThan(0)
    const rolledBack = await rollback(database.pool, real, { to: '0' })
    expect(rolledBack.length).toBeGreaterThan(0)
    const left = await database.pool.query(
      `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name like 'id\\_%' and table_name <> 'id_migrations'`
    )
    expect(left.rows[0].n).toBe(0)
  })
})

/** Forget the fixture migrations, so the real ones start from nothing. */
const useFreshSchema = (database: ReturnType<typeof useDatabase>) => async () => {
  await database.pool.query('drop table if exists t_y, t_z, id_migrations')
}
