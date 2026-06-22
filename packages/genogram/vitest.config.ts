import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
    // userEvent.type() yields a setTimeout(0) macrotask per keystroke; on a CI
    // runner saturated by the parallel monorepo test run those macrotasks get
    // starved and multi-keystroke interaction tests (e.g. OwnerDataForm) can
    // exceed vitest's default 5000ms per-test budget even though they finish in
    // ~300ms locally. Give jsdom interaction tests headroom under load.
    testTimeout: 20000,
    setupFiles: ['./test-setup.ts'],
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['**/*.test.ts', 'node'],
    ],
  },
})
