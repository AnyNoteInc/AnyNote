import { describe, it, expect } from 'vitest'

import { endPosition, positionBetween } from '../../src/kanban/helpers.ts'

describe('kanban position helpers', () => {
  it('positionBetween returns the midpoint, or gaps at the ends', () => {
    expect(positionBetween(1000, 2000)).toBe(1500)
    expect(positionBetween(1000, null)).toBe(2024)
    expect(positionBetween(null, 2000)).toBe(976)
    expect(positionBetween(null, null)).toBe(0)
  })

  it('endPosition returns max + gap, or 0 when empty', () => {
    expect(endPosition([])).toBe(0)
    expect(endPosition([{ position: 1024 }, { position: 4096 }])).toBe(5120)
  })
})
