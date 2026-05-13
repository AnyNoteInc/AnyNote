import { describe, expect, it } from 'vitest'

import { computeResizedWidths, MIN_WIDTH_FRACTION } from './column-resize'

describe('computeResizedWidths', () => {
  it('returns inputs unchanged when delta is 0', () => {
    const result = computeResizedWidths(1, 1, 0, MIN_WIDTH_FRACTION)
    expect(result).toEqual({ left: 1, right: 1 })
  })

  it('moves share from right to left for positive delta', () => {
    const result = computeResizedWidths(1, 1, 0.3, MIN_WIDTH_FRACTION)
    expect(result.left).toBeCloseTo(1.3, 5)
    expect(result.right).toBeCloseTo(0.7, 5)
    expect(result.left + result.right).toBeCloseTo(2, 5)
  })

  it('moves share from left to right for negative delta', () => {
    const result = computeResizedWidths(1, 1, -0.4, MIN_WIDTH_FRACTION)
    expect(result.left).toBeCloseTo(0.6, 5)
    expect(result.right).toBeCloseTo(1.4, 5)
    expect(result.left + result.right).toBeCloseTo(2, 5)
  })

  it('keeps the sum identical to left + right', () => {
    const result = computeResizedWidths(2, 1, 0.5, MIN_WIDTH_FRACTION)
    expect(result.left + result.right).toBeCloseTo(3, 5)
  })

  it('clamps left when delta would push it below sum * MIN_WIDTH_FRACTION', () => {
    // sum = 2, min = 0.2 (10%), so left can go no lower than 0.2.
    const result = computeResizedWidths(1, 1, -2, 0.1)
    expect(result.left).toBeCloseTo(0.2, 5)
    expect(result.right).toBeCloseTo(1.8, 5)
  })

  it('clamps right when delta would push it below sum * MIN_WIDTH_FRACTION', () => {
    const result = computeResizedWidths(1, 1, 2, 0.1)
    expect(result.left).toBeCloseTo(1.8, 5)
    expect(result.right).toBeCloseTo(0.2, 5)
  })

  it('works with non-equal starting widths', () => {
    const result = computeResizedWidths(2, 1, 0.1, MIN_WIDTH_FRACTION)
    expect(result.left).toBeCloseTo(2.1, 5)
    expect(result.right).toBeCloseTo(0.9, 5)
  })

  it('exposes MIN_WIDTH_FRACTION = 0.1', () => {
    expect(MIN_WIDTH_FRACTION).toBe(0.1)
  })
})
