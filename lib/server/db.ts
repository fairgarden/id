import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getConfig } from './config.ts'
import { migrate } from './migrator.ts'
import * as schema from './schema.ts'

/**
 * The database, through Drizzle over node-postgres.
 *
 * Any Postgres works — Neon on Vercel, a container, a managed instance — by
 * setting `FG_ID_DATABASE_URL` (or `DATABASE_URL`, which Neon's Vercel
 * integration sets). Without one, development starts PGlite, which is
 * Postgres compiled to WebAssembly, behind a local Postgres socket, so the
 * app still talks to it through `pg` and `pnpm dev` needs nothing installed.
 *
 * Loaded natively by the CLI as well, so it keeps to syntax Node can strip.
 */

export type Database = NodePgDatabase<typeof schema>
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
/** Either; take this in a helper that may run inside a transaction. */
export type Executor = Database | Transaction

export interface Connection {
  pool: pg.Pool
  database: Database
  /** Where it connected, with any password removed, for messages. */
  describe: string
  close(): Promise<void>
}

// Kept on globalThis: Next bundles API routes and pages separately and reloads
// modules in development, but they all share the process.
const KEY = Symbol.for('@fairgarden/id/db')
type Holder = { [KEY]?: Promise<Connection> }

/** The shared connection for request handlers. */
export const connection = (): Promise<Connection> => {
  const holder = globalThis as Holder
  holder[KEY] ??= openConnection({ autoMigrate: true }).catch((error: unknown) => {
    delete holder[KEY]
    throw error
  })
  return holder[KEY]
}

export const db = async (): Promise<Database> => (await connection()).database

/**
 * Connect, starting the embedded database when there is no other.
 *
 * `autoMigrate` applies pending migrations to the embedded database only. A
 * real one is migrated on purpose, with `pnpm db:migrate`, so a deployment
 * never changes its schema by surprise and a rollback is not undone by the
 * next cold start.
 */
export const openConnection = async ({
  autoMigrate,
}: {
  autoMigrate: boolean
}): Promise<Connection> => {
  const config = getConfig()
  const embedded = config.databaseUrl ? undefined : await startEmbedded(config.dataDir, config.embeddedDatabasePort)
  const connectionString = config.databaseUrl ?? embedded!.url

  const pool = new pg.Pool({
    connectionString,
    // The embedded server runs every connection through one Postgres session,
    // so more than one from a process could interleave their statements.
    max: embedded ? 1 : Number(process.env.FG_ID_DATABASE_POOL_SIZE ?? 5),
    // Serverless instances freeze between requests; do not sit on
    // connections a pooler like Neon's would rather hand to someone else.
    idleTimeoutMillis: 5_000,
    // Waiting longer than this for a connection is a bug, not load.
    connectionTimeoutMillis: 15_000,
  })
  pool.on('error', (error) => console.error('[id] idle database client failed', error))

  if (embedded && autoMigrate) {
    const directory = findMigrations()
    if (directory) {
      const applied = await migrate(pool, directory)
      if (applied.length > 0) console.info(`[id] applied ${applied.join(', ')}`)
    } else {
      console.warn('[id] could not find drizzle/ to migrate the embedded database; run pnpm db:migrate')
    }
  }

  const describe = embedded
    ? `embedded database in ${config.dataDir} (${embedded.url})`
    : connectionString.replace(/\/\/[^@/]*@/, '//***@')

  return {
    pool,
    database: drizzle({ client: pool, schema }),
    describe,
    async close() {
      await pool.end()
      await embedded?.stop()
    },
  }
}

/**
 * The migrations folder, for migrating the embedded database from a dev
 * server. Found from the working directory, which is this app's own or a
 * monolith's that depends on it; `FG_ID_MIGRATIONS_DIR` overrides.
 */
const findMigrations = (): string | undefined => {
  const cwd = process.cwd()
  // Development only: never traced into a build.
  const candidates = [
    process.env.FG_ID_MIGRATIONS_DIR,
    path.join(/* turbopackIgnore: true */ cwd, 'node_modules', '@fairgarden', 'id', 'drizzle'),
    path.join(/* turbopackIgnore: true */ cwd, 'drizzle'),
  ]
  return candidates.find((candidate) => {
    if (!candidate || !existsSync(path.join(candidate, 'meta', '_journal.json'))) return false
    try {
      const pkg = JSON.parse(readFileSync(path.join(candidate, '..', 'package.json'), 'utf8'))
      return pkg.name === '@fairgarden/id'
    } catch {
      return false
    }
  })
}

interface Embedded {
  url: string
  stop(): Promise<void>
}

const canConnect = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Serve the embedded database on a local port, or find it already served.
 *
 * PGlite corrupts its files if two processes open them, so whoever holds the
 * lock file serves it and everyone else — the other half of a dev server, the
 * CLI, drizzle-kit studio — connects to that port.
 */
const startEmbedded = async (dataDir: string, port: number): Promise<Embedded> => {
  if (process.env.VERCEL) {
    throw new Error(
      'No database configured. Set FG_ID_DATABASE_URL, or connect Neon, which sets DATABASE_URL.'
    )
  }
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`
  const idle: Embedded = { url, stop: async () => undefined }

  mkdirSync(dataDir, { recursive: true })
  const lock = path.join(dataDir, 'fg-embedded.lock')

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: 'wx' })
    } catch {
      const owner = Number(readFileSync(lock, 'utf8'))
      if (owner !== process.pid && isAlive(owner)) {
        if (await canConnect(port)) return idle
        await sleep(100)
        continue
      }
      rmSync(lock, { force: true })
      continue
    }

    const release = () => {
      try {
        if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock, { force: true })
      } catch {
        // already gone
      }
    }
    process.once('exit', release)

    try {
      // Left out of the bundle and of a deployment's traced files: both are
      // for development only, and PGlite finds its WebAssembly relative to
      // itself. Joined at runtime so file tracing cannot follow them.
      const pgliteSpecifier = ['@electric-sql', 'pglite'].join('/')
      const socketSpecifier = ['@electric-sql', 'pglite-socket'].join('/')
      const { PGlite } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pgliteSpecifier)
      const { PGLiteSocketServer } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ socketSpecifier)
      const pglite = await PGlite.create(dataDir)
      const server = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 16 })
      await server.start()
      console.info(`[id] serving the embedded database in ${dataDir} on 127.0.0.1:${port}`)
      return {
        url,
        async stop() {
          await server.stop()
          await pglite.close()
          release()
          process.removeListener('exit', release)
        },
      }
    } catch (error) {
      release()
      throw new Error(
        'Could not start the embedded database. Set FG_ID_DATABASE_URL to use your own Postgres.',
        { cause: error }
      )
    }
  }
  throw new Error(`The embedded database in ${dataDir} is locked but not being served on port ${port}`)
}
