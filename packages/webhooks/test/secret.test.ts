import { describe, expect, it } from 'vitest'

import { generateChallenge, generateWebhookSecret } from '../src/secret.ts'

describe('generateWebhookSecret', () => {
  it('returns whsec_ + 32 base62 chars', () => {
    const secret = generateWebhookSecret()
    expect(secret).toMatch(/^whsec_[A-Za-z0-9]{32}$/)
  })

  it('generates unique secrets', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateWebhookSecret()))
    expect(secrets.size).toBe(100)
  })
})

describe('generateChallenge', () => {
  it('returns 32 base62 chars (no prefix)', () => {
    const challenge = generateChallenge()
    expect(challenge).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(challenge).toHaveLength(32)
  })

  it('generates unique challenges', () => {
    const challenges = new Set(Array.from({ length: 100 }, () => generateChallenge()))
    expect(challenges.size).toBe(100)
  })
})
