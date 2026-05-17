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

  it('throws on tampered IV', () => {
    const payload = encryptSecret('hello')
    const tamperedIv = Buffer.alloc(12).toString('base64')
    expect(() => decryptSecret({ ...payload, iv: tamperedIv })).toThrow()
  })

  it('throws on tampered tag', () => {
    const payload = encryptSecret('hello')
    const tamperedTag = Buffer.alloc(16).toString('base64')
    expect(() => decryptSecret({ ...payload, tag: tamperedTag })).toThrow()
  })

  it('throws on truncated tag (downgrade attack)', () => {
    const payload = encryptSecret('hello')
    const truncated = Buffer.from(payload.tag, 'base64').slice(0, 4).toString('base64')
    expect(() => decryptSecret({ ...payload, tag: truncated })).toThrow(/auth tag length/)
  })

  it('throws when SECRETS_ENCRYPTION_KEY is missing', () => {
    const original = process.env.SECRETS_ENCRYPTION_KEY
    delete process.env.SECRETS_ENCRYPTION_KEY
    try {
      expect(() => encryptSecret('x')).toThrow(/SECRETS_ENCRYPTION_KEY is not set/)
    } finally {
      process.env.SECRETS_ENCRYPTION_KEY = original
    }
  })

  it('throws when SECRETS_ENCRYPTION_KEY is wrong length', () => {
    const original = process.env.SECRETS_ENCRYPTION_KEY
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(31).toString('base64')
    try {
      expect(() => encryptSecret('x')).toThrow(/must decode to 32 bytes/)
    } finally {
      process.env.SECRETS_ENCRYPTION_KEY = original
    }
  })
})
