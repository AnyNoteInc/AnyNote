import { describe, it, expect } from 'vitest'

import { parentTitleFontWeight } from '@/components/kanban/lib/parent-style'

describe('parentTitleFontWeight', () => {
  it('returns the base weight for a non-parent', () => {
    expect(parentTitleFontWeight(false, 600)).toBe(600)
    expect(parentTitleFontWeight(false, undefined)).toBeUndefined()
  })

  it('steps one level up from a numeric base for a parent', () => {
    expect(parentTitleFontWeight(true, 600)).toBe(700)
  })

  it('defaults a parent to 600 when the base is undefined', () => {
    expect(parentTitleFontWeight(true, undefined)).toBe(600)
  })
})
