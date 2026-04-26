import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './apps/e2e',
  timeout: 60_000,
  reporter: 'list',
  webServer: {
    command: 'pnpm --filter web exec next dev --turbo --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    env: {
      BETTER_AUTH_URL: 'http://localhost:3100',
      NEXT_PUBLIC_BASE_URL: 'http://localhost:3100',
      PLAYWRIGHT: 'true',
      YOOKASSA_MOCK_ENABLED: 'true',
      YOOKASSA_RETURN_URL_BASE: 'http://localhost:3100',
    },
  },
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
})
