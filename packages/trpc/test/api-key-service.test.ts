import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'

import { generateApiKey, hashApiKey, computeExpiresAt } from '../src/services/api-key'

describe('generateApiKey', () => {
  it('returns fullKey starting with ank_ and 28 chars total', () => {
    const k = generateApiKey()
    expect(k.fullKey).toMatch(/^ank_[0-9A-Za-z]{24}$/)
    expect(k.fullKey).toHaveLength(28)
  })

  it('returns prefix = first 8 chars of body and lastFour = last 4 chars', () => {
    const k = generateApiKey()
    const body = k.fullKey.slice(4)
    expect(k.prefix).toBe(body.slice(0, 8))
    expect(k.lastFour).toBe(body.slice(-4))
  })

  it('returns hash = sha256(fullKey) hex', () => {
    const k = generateApiKey()
    const expected = createHash('sha256').update(k.fullKey).digest('hex')
    expect(k.hash).toBe(expected)
    expect(k.hash).toHaveLength(64)
  })

  it('produces distinct keys across calls', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().fullKey))
    expect(keys.size).toBe(50)
  })
})

describe('hashApiKey', () => {
  it('matches the hash returned by generateApiKey', () => {
    const k = generateApiKey()
    expect(hashApiKey(k.fullKey)).toBe(k.hash)
  })
})

describe('computeExpiresAt', () => {
  const now = new Date('2026-05-27T10:00:00.000Z')

  it('returns null for "never"', () => {
    expect(computeExpiresAt('never', now)).toBeNull()
  })

  it('adds 7 days for "7d"', () => {
    const r = computeExpiresAt('7d', now)
    expect(r?.toISOString()).toBe('2026-06-03T10:00:00.000Z')
  })

  it('adds 30 days for "30d"', () => {
    const r = computeExpiresAt('30d', now)
    expect(r?.toISOString()).toBe('2026-06-26T10:00:00.000Z')
  })

  it('adds 90 days for "90d"', () => {
    const r = computeExpiresAt('90d', now)
    expect(r?.toISOString()).toBe('2026-08-25T10:00:00.000Z')
  })

  it('adds 1 year for "1y"', () => {
    const r = computeExpiresAt('1y', now)
    expect(r?.toISOString()).toBe('2027-05-27T10:00:00.000Z')
  })
})
