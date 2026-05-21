import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    // Tiptap requires a single @tiptap/core instance. Dedupe so the test
    // resolver collapses to one copy instead of picking up a stale duplicate
    // left in the pnpm store.
    dedupe: ['@tiptap/core', '@tiptap/pm'],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
