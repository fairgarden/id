import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'
import { afterAll, beforeAll } from 'vitest'
import { declaredMigrations, migrate } from '@fairgarden/distribution/migrations'

export const ROOT = path.resolve(import.meta.dirname, '..', '..')

/**
 * A fresh in-memory Postgres for one test file, reached the way production
 * reaches Neon: `FG_ID_DATABASE_URL`, through `pg`. Migrated with the real
 * migrations unless `migrated` is false.
 */
export const useDatabase = ({ migrated = true } = {}) => {
  const database = { url: '', pool: undefined as unknown as pg.Pool }
  let pglite: PGlite
  let server: PGLiteSocketServer

  beforeAll(async () => {
    pglite = await PGlite.create()
    server = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1', maxConnections: 8 })
    await server.start()
    database.url = `postgres://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`
    process.env.FG_ID_DATABASE_URL = database.url
    // One connection, as with the embedded database: PGlite is one session.
    process.env.FG_ID_DATABASE_POOL_SIZE = '1'
    database.pool = new pg.Pool({ connectionString: database.url, max: 1 })
    if (migrated) {
      const migrations = declaredMigrations(ROOT)!
      await migrate(database.pool, migrations.directory, migrations)
    }
  })

  afterAll(async () => {
    await database.pool?.end()
    const key = Symbol.for('@fairgarden/id/db')
    const holder = globalThis as Record<symbol, Promise<{ close(): Promise<void> }> | undefined>
    await (await holder[key]?.catch(() => undefined))?.close()
    delete holder[key]
    await server?.stop()
    await pglite?.close()
  })

  return database
}
