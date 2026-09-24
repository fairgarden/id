import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` writes the next migration into drizzle/ from the schema;
// `pnpm db:studio` browses whichever database the app would use, including
// the embedded one while the dev server is running.
for (const file of ['.env.development.local', '.env.local', '.env.development', '.env']) {
  try {
    process.loadEnvFile(file)
  } catch {
    // not there
  }
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/server/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.FG_ID_DATABASE_URL ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      `postgres://postgres:postgres@127.0.0.1:${process.env.FG_ID_EMBEDDED_DATABASE_PORT ?? 54310}/postgres?sslmode=disable`,
  },
})
