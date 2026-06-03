import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Vitest globalSetup: load the repo-root .env so DATABASE_URL is present
// before any test module imports `prisma` from ../src. Mirrors
// packages/trpc/test/setup.ts (the repo's convention for db-backed tests).
export function setup() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const envPath = resolve(here, '../../../.env')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  } catch {
    // ignore — env may already be set in the shell/CI
  }
}
