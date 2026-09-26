import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests: test/**/*.test.ts. The browser tests are Playwright's, in e2e/.
export default defineConfig({
  resolve: {
    alias: { '@fairgarden/id': path.resolve(import.meta.dirname) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Each file gets its own process, so its own database and config.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
