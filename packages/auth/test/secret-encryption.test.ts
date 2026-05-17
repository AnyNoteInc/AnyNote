import { describe, expect, it, beforeAll } from 'vitest'
import { encryptSecret, decryptSecret } from '../src/secret-encryption'
import crypto from 'node:crypto'

beforeAll(() => {
  process.env.SECRETS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
})

describe('secret-encryption', () => {
  it('round-trips an arbitrary string', () => {
    const payload = encryptSecret('sk-proj-XYZ')
    expect(decryptSecret(payload)).toBe('sk-proj-XYZ')
    expect(payload.ciphertext).not.toContain('sk-proj-XYZ')
  })

  it('produces a different ciphertext each call (random IV)', () => {
    const a = encryptSecret('same-input')
    const b = encryptSecret('same-input')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('throws on tampered ciphertext', () => {
    const payload = encryptSecret('hello')
    const tampered = { ...payload, ciphertext: payload.ciphertext.replace(/.$/, 'A') }
    expect(() => decryptSecret(tampered)).toThrow()
  })
})
