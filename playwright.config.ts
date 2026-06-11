import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './apps/e2e',
  timeout: 60_000,
  reporter: 'list',
  webServer: [
    {
      command: 'pnpm --filter web exec next dev --turbo --port 3100',
      url: 'http://localhost:3100',
      reuseExistingServer: false,
      env: {
        BETTER_AUTH_URL: 'http://localhost:3100',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3100',
        PLAYWRIGHT: 'true',
        YOOKASSA_MOCK_ENABLED: 'true',
        YOOKASSA_RETURN_URL_BASE: 'http://localhost:3100',
        PLANTUML_URL: process.env.PLANTUML_URL ?? 'http://localhost:3002',
        // Point tRPC aiProvider.create server-side pings at the mock agents server.
        AGENTS_SERVICE_URL: 'http://127.0.0.1:8091',
        // Unroutable port: telegram connect's getMe fails instantly and
        // deterministically — no live Bot API calls ever leave the test run.
        TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9',
        // Agent OS — pass through from the outer shell if set.
        // These are needed by the chat API route (agents proxy) and the
        // encryptFixture helper in agent-qa-citations.spec.ts.
        ...(process.env.SECRETS_ENCRYPTION_KEY
          ? { SECRETS_ENCRYPTION_KEY: process.env.SECRETS_ENCRYPTION_KEY }
          : {}),
        ...(process.env.AGENTS_URL ? { AGENTS_URL: process.env.AGENTS_URL } : {}),
        ...(process.env.AGENTS_TO_ENGINES_SECRET
          ? { AGENTS_TO_ENGINES_SECRET: process.env.AGENTS_TO_ENGINES_SECRET }
          : {}),
        ...(process.env.BETTER_AUTH_JWT_AGENTS_AUDIENCE
          ? { BETTER_AUTH_JWT_AGENTS_AUDIENCE: process.env.BETTER_AUTH_JWT_AGENTS_AUDIENCE }
          : {}),
        ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
        ...(process.env.AGENTS_JWT_SECRET
          ? { AGENTS_JWT_SECRET: process.env.AGENTS_JWT_SECRET }
          : {}),
        ...(process.env.ENGINES_MCP_URL ? { ENGINES_MCP_URL: process.env.ENGINES_MCP_URL } : {}),
      },
    },
    {
      command: 'node apps/e2e/mocks/agents-validation-server.mjs',
      port: 8091,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      env: { ...process.env, MOCK_AGENTS_PORT: '8091' },
    },
  ],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
})
