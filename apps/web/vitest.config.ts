import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` is a Next.js build-time marker with no runtime; under
      // Vitest (node env) it isn't installed, so resolve it to an empty stub.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    globalSetup: ['test/setup.ts'],
    setupFiles: ['test/setup.jsdom.ts'],
    // Async route/interaction tests await real macrotasks; on a CI runner
    // saturated by the parallel monorepo test run the event loop is starved and
    // an await can exceed vitest's default 5000ms per-test budget even though
    // it resolves in a few ms locally (the known files-upload-kinds GATE-flake).
    // Give them headroom under load.
    testTimeout: 20000,
  },
})
