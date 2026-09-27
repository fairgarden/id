import { describe, expect, it } from 'vitest'
import { declaredMigrations, migrate, rollback } from '@fairgarden/distribution/migrations'
import { ROOT, useDatabase } from './helpers/database'

/**
 * The migrator itself is fg-dist's, and tested there. What is this app's is
 * its migrations: that they apply, and that every one of them undoes.
 */
describe('the migrations', () => {
  const database = useDatabase({ migrated: false })

  it('are declared where fg-dist looks, under their own journal', () => {
    const migrations = declaredMigrations(ROOT)!
    expect(migrations.table).toBe('id_migrations')
    // the database the app itself uses, whichever of these is set first
    expect(migrations.database).toEqual(['FG_ID_DATABASE_URL', 'DATABASE_URL', 'POSTGRES_URL'])
  })

  it('apply, and undo completely', async () => {
    const migrations = declaredMigrations(ROOT)!
    expect((await migrate(database.pool, migrations.directory, migrations)).length).toBeGreaterThan(0)
    expect((await rollback(database.pool, migrations.directory, migrations, { to: '0' })).length).toBeGreaterThan(0)
    const left = await database.pool.query(
      `select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name like 'id\\_%' and table_name <> 'id_migrations'`
    )
    expect(left.rows[0].n).toBe(0)
  })
})
