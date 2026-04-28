import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/setup.ts'],
    server: {
      deps: {
        moduleDirectories: ['node_modules'],
      },
    },
  },
  resolve: {
    alias: {
      'server-only': new URL('./test/__mocks__/server-only.js', import.meta.url).pathname,
    },
  },
})
