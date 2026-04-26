import { describe, expect, it } from 'vitest'

import { getPlanDisplayName } from '../src/components/billing/plan-labels'

describe('plan labels', () => {
  it('uses Russian display names for canonical subscription plans', () => {
    expect(getPlanDisplayName({ slug: 'personal', name: 'Personal' })).toBe('Персональный')
    expect(getPlanDisplayName({ slug: 'pro', name: 'Pro' })).toBe('ПРО')
    expect(getPlanDisplayName({ slug: 'max', name: 'Max' })).toBe('МАКС')
  })

  it('falls back to the stored name for non-canonical plans', () => {
    expect(getPlanDisplayName({ slug: 'custom', name: 'Enterprise' })).toBe('Enterprise')
  })
})
