import { describe, expect, it } from 'vitest'

import { computeDropZone, type DropZone } from './drop-placement.zones'

const rect = { left: 100, top: 100, right: 300, bottom: 200 } as const
// width = 200, height = 100
// LEFT zone = x < 100 (left of rect), RIGHT zone = x > 300 (right of rect)
// inside the rect → TOP (upper half) / BOTTOM (lower half)

describe('computeDropZone', () => {
  it('returns LEFT when cursor is past the rect on the left', () => {
    expect(computeDropZone({ x: 50, y: 150 }, rect, { canSide: true })).toBe<DropZone>('LEFT')
    expect(computeDropZone({ x: 99, y: 150 }, rect, { canSide: true })).toBe<DropZone>('LEFT')
  })

  it('returns RIGHT when cursor is past the rect on the right', () => {
    expect(computeDropZone({ x: 301, y: 150 }, rect, { canSide: true })).toBe<DropZone>('RIGHT')
    expect(computeDropZone({ x: 500, y: 150 }, rect, { canSide: true })).toBe<DropZone>('RIGHT')
  })

  it('returns TOP across the full width when cursor is in the upper half', () => {
    expect(computeDropZone({ x: 100, y: 110 }, rect, { canSide: true })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 200, y: 149 }, rect, { canSide: true })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 300, y: 100 }, rect, { canSide: true })).toBe<DropZone>('TOP')
  })

  it('returns BOTTOM across the full width when cursor is in the lower half', () => {
    expect(computeDropZone({ x: 100, y: 151 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
    expect(computeDropZone({ x: 200, y: 199 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
    expect(computeDropZone({ x: 300, y: 200 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
  })

  it('falls back to TOP/BOTTOM when canSide is false and cursor is outside horizontally', () => {
    expect(computeDropZone({ x: 50, y: 110 }, rect, { canSide: false })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 500, y: 199 }, rect, { canSide: false })).toBe<DropZone>('BOTTOM')
  })

  it('returns null when cursor is outside the rect vertically', () => {
    expect(computeDropZone({ x: 200, y: 50 }, rect, { canSide: true })).toBeNull()
    expect(computeDropZone({ x: 200, y: 250 }, rect, { canSide: true })).toBeNull()
  })
})
