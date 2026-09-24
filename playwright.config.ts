import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests for the id service, run against a production build with a
 * mock service to sign in to (e2e/mock-service.ts). Nothing outside this
 * repository is needed: `pnpm test:e2e`.
 */

const ID = 'http://localhost:3110'
const MOCK = 'http://localhost:3111'

export default defineConfig({
  testDir: 'e2e',
  // Every test signs up its own person, so they can share the server.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: ID,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-service.ts',
      url: `${MOCK}/health`,
      env: { MOCK_PORT: '3111', ID_URL: ID },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/serve.ts',
      url: `${ID}/.well-known/openid-configuration`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ID_PORT: '3110',
        FG_ID_URL: ID,
        FG_ID_NAME: 'Test Garden',
        FG_ID_DATA_DIR: 'e2e/.data',
        FG_ID_EMBEDDED_DATABASE_PORT: '54410',
        FG_ID_SERVICE_MOCK_URL: MOCK,
        FG_ID_SERVICE_MOCK_NAME: 'Mock Service',
        FG_ID_SERVICE_MOCK_SECRET: 'mock-secret',
        FG_ID_SERVICE_CLUB_URL: `${MOCK}/club`,
        FG_ID_SERVICE_CLUB_NAME: 'Club',
        FG_ID_SERVICE_CLUB_SECRET: 'club-secret',
        FG_ID_SERVICE_CLUB_CLAIMS: 'club',
        // An organization's rules on top of id's own, as a deployment runs them.
        E2E_POLICY: 'examples/privacy',
      },
    },
  ],
})
