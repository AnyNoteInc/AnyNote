import { describe, expect, it } from 'vitest'

import { computeDropZone, type DropZone } from './drop-placement.zones'

const rect = { left: 100, top: 100, right: 300, bottom: 200 } as const
// width = 200, height = 100
// LEFT zone = [100, 120), RIGHT zone = (280, 300]

describe('computeDropZone', () => {
  it('returns LEFT when cursor is in the left 10%', () => {
    expect(computeDropZone({ x: 110, y: 150 }, rect, { canSide: true })).toBe<DropZone>('LEFT')
    expect(computeDropZone({ x: 119, y: 150 }, rect, { canSide: true })).toBe<DropZone>('LEFT')
  })

  it('returns RIGHT when cursor is in the right 10%', () => {
    expect(computeDropZone({ x: 281, y: 150 }, rect, { canSide: true })).toBe<DropZone>('RIGHT')
    expect(computeDropZone({ x: 299, y: 150 }, rect, { canSide: true })).toBe<DropZone>('RIGHT')
  })

  it('returns TOP when cursor is in the middle 80% and upper half', () => {
    expect(computeDropZone({ x: 200, y: 110 }, rect, { canSide: true })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 200, y: 149 }, rect, { canSide: true })).toBe<DropZone>('TOP')
  })

  it('returns BOTTOM when cursor is in the middle 80% and lower half', () => {
    expect(computeDropZone({ x: 200, y: 151 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
    expect(computeDropZone({ x: 200, y: 199 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
  })

  it('falls back to TOP/BOTTOM in side zones when canSide is false', () => {
    expect(computeDropZone({ x: 110, y: 110 }, rect, { canSide: false })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 290, y: 199 }, rect, { canSide: false })).toBe<DropZone>('BOTTOM')
  })

  it('returns null when cursor is outside the rect', () => {
    expect(computeDropZone({ x: 50, y: 150 }, rect, { canSide: true })).toBeNull()
    expect(computeDropZone({ x: 150, y: 250 }, rect, { canSide: true })).toBeNull()
  })
})
