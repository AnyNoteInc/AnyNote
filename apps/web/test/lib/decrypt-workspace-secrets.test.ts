import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'
import { encryptSecret } from '@repo/auth'
import {
  decryptModelConnection,
  decryptMcpHeadersMap,
} from '@/lib/decrypt-workspace-secrets'

beforeAll(() => {
  process.env.SECRETS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
})

describe('decryptModelConnection', () => {
  it('returns null on null input', () => {
    expect(decryptModelConnection(null)).toBeNull()
  })

  it('round-trips a JSON connection object', () => {
    const stored = encryptSecret(JSON.stringify({ apiKey: 'sk-X' }))
    expect(decryptModelConnection(stored as unknown as object)).toEqual({ apiKey: 'sk-X' })
  })
})

describe('decryptMcpHeadersMap', () => {
  it('decrypts each server headers field', () => {
    const a = encryptSecret(JSON.stringify({ Authorization: 'Bearer 1' }))
    const b = encryptSecret(JSON.stringify({ 'X-Key': '2' }))
    const decrypted = decryptMcpHeadersMap([
      { id: 'a', headers: a as unknown },
      { id: 'b', headers: b as unknown },
    ])
    expect(decrypted.a?.Authorization).toBe('Bearer 1')
    expect(decrypted.b?.['X-Key']).toBe('2')
  })
})
