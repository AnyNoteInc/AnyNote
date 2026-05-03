import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

function findEnvFile(startDir: string): string | null {
  let current = startDir
  while (true) {
    const candidate = resolve(current, '.env')
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const envPath = findEnvFile(currentDir)

if (envPath) {
  loadEnv({ path: envPath })
} else {
  console.warn(
    '[@repo/db] .env not found while walking up from packages/db. ' +
      'DATABASE_URL must be provided via process.env.',
  )
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'tsx ./prisma/seed.ts',
  },
})
