import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/setup.ts'],
    // Real-DB integration suites tick bounded drain loops; under full-gates
    // shared-Postgres contention a single tick's round-trips can exceed
    // vitest's 5s default. 30s absorbs the load without masking real hangs.
    testTimeout: 30_000,
  },
})
