import { beforeEach, describe, expect, it } from 'vitest'

import {
  INLINE_AI_RATE_LIMIT_MAX,
  __resetInlineAiRateLimit,
  isInlineAiRateLimited,
} from '../src/lib/ai/inline-rate-limit'

beforeEach(() => __resetInlineAiRateLimit())

describe('inline-ai rate limit', () => {
  it('allows up to the limit then blocks', () => {
    const key = { userId: 'u1', workspaceId: 'w1' }
    for (let i = 0; i < INLINE_AI_RATE_LIMIT_MAX; i += 1) {
      expect(isInlineAiRateLimited(key)).toBe(false)
    }
    // The next call in the same window is blocked.
    expect(isInlineAiRateLimited(key)).toBe(true)
  })

  it('treats separate (user, workspace) keys independently', () => {
    const a = { userId: 'u1', workspaceId: 'w1' }
    const b = { userId: 'u2', workspaceId: 'w1' }
    const c = { userId: 'u1', workspaceId: 'w2' }
    for (let i = 0; i < INLINE_AI_RATE_LIMIT_MAX; i += 1) {
      expect(isInlineAiRateLimited(a)).toBe(false)
    }
    expect(isInlineAiRateLimited(a)).toBe(true)
    // A different user on the same workspace, and the same user on a different
    // workspace, both still have a full budget.
    expect(isInlineAiRateLimited(b)).toBe(false)
    expect(isInlineAiRateLimited(c)).toBe(false)
  })

  it('__resetInlineAiRateLimit clears all counters', () => {
    const key = { userId: 'u1', workspaceId: 'w1' }
    for (let i = 0; i < INLINE_AI_RATE_LIMIT_MAX; i += 1) isInlineAiRateLimited(key)
    expect(isInlineAiRateLimited(key)).toBe(true)
    __resetInlineAiRateLimit()
    expect(isInlineAiRateLimited(key)).toBe(false)
  })
})
