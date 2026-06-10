import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function setup() {
  try {
    const envPath = resolve(__dirname, '../../../.env')
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
    // ignore — env may already be set
  }
  // The worker tests call encryptSecret/decryptSecret; guarantee a valid
  // AES-256 key even when the root .env doesn't provide one (fresh CI DB).
  if (!process.env.SECRETS_ENCRYPTION_KEY) {
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  }
}
