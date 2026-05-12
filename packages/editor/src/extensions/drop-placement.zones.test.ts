import { describe, expect, it } from 'vitest'

import { computeDropZone, type DropZone } from './drop-placement.zones'

const rect = { left: 100, top: 100, right: 300, bottom: 200 } as const
// width = 200, height = 100
// LEFT zone = [100, 150), RIGHT zone = (250, 300]

describe('computeDropZone', () => {
  it('returns LEFT when cursor is in the left 25%', () => {
    expect(computeDropZone({ x: 120, y: 150 }, rect, { canSide: true })).toBe<DropZone>('LEFT')
    expect(computeDropZone({ x: 149, y: 150 }, rect, { canSide: true })).toBe<DropZone>('LEFT')
  })

  it('returns RIGHT when cursor is in the right 25%', () => {
    expect(computeDropZone({ x: 251, y: 150 }, rect, { canSide: true })).toBe<DropZone>('RIGHT')
    expect(computeDropZone({ x: 299, y: 150 }, rect, { canSide: true })).toBe<DropZone>('RIGHT')
  })

  it('returns TOP when cursor is in the middle 50% and upper half', () => {
    expect(computeDropZone({ x: 200, y: 110 }, rect, { canSide: true })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 200, y: 149 }, rect, { canSide: true })).toBe<DropZone>('TOP')
  })

  it('returns BOTTOM when cursor is in the middle 50% and lower half', () => {
    expect(computeDropZone({ x: 200, y: 151 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
    expect(computeDropZone({ x: 200, y: 199 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
  })

  it('falls back to TOP/BOTTOM in side zones when canSide is false', () => {
    expect(computeDropZone({ x: 120, y: 110 }, rect, { canSide: false })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 251, y: 199 }, rect, { canSide: false })).toBe<DropZone>('BOTTOM')
  })

  it('returns null when cursor is outside the rect', () => {
    expect(computeDropZone({ x: 50, y: 150 }, rect, { canSide: true })).toBeNull()
    expect(computeDropZone({ x: 150, y: 250 }, rect, { canSide: true })).toBeNull()
  })
})
