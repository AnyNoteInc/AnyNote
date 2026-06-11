import { describe, expect, it } from 'vitest'

import { generateLinkCode, generateTelegramWebhookSecret, hashLinkCode } from '../src/secret.ts'

describe('generateTelegramWebhookSecret', () => {
  it('returns 32 base62 chars (no prefix)', () => {
    const secret = generateTelegramWebhookSecret()
    expect(secret).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(secret).toHaveLength(32)
  })

  it('generates unique secrets', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateTelegramWebhookSecret()))
    expect(secrets.size).toBe(100)
  })
})

describe('generateLinkCode', () => {
  it('returns 8 uppercase base32 chars', () => {
    const code = generateLinkCode()
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(code).toHaveLength(8)
  })

  it('never contains the ambiguous chars 0/O/1/I', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLinkCode()
      expect(code).not.toMatch(/[0O1I]/)
    }
  })

  it('generates unique codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateLinkCode()))
    expect(codes.size).toBe(100)
  })
})

describe('hashLinkCode', () => {
  it('returns a sha256 hex digest', () => {
    expect(hashLinkCode('ABCD2345')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    expect(hashLinkCode('ABCD2345')).toBe(hashLinkCode('ABCD2345'))
  })

  it('differs across inputs', () => {
    expect(hashLinkCode('ABCD2345')).not.toBe(hashLinkCode('ABCD2346'))
  })
})
