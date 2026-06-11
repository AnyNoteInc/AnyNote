import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Real-DB suites run as parallel test files against the SHARED dev Postgres:
    // they rely on per-suite email-suffix namespacing and race-safe fixture
    // upserts (upsert / createMany skipDuplicates) for parallel-file safety.
    globalSetup: ['test/setup.ts'],
  },
})
