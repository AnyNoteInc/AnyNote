import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    // Release CI runs the whole monorepo's tests in parallel; the default
    // 5000ms starves jsdom+userEvent tests under that load (chat-thread).
    testTimeout: 20000,
  },
})
