import { describe, expect, it } from 'vitest'

import { REMINDER_CHIP_SX, REMINDER_WRAPPER_STYLE } from './layout'

describe('reminder node view layout', () => {
  it('keeps the node wrapper and chip inline instead of stretching to the line width', () => {
    expect(REMINDER_WRAPPER_STYLE).toMatchObject({
      display: 'inline-flex',
      boxSizing: 'border-box',
    })
    expect(REMINDER_WRAPPER_STYLE).not.toHaveProperty('width')
    expect(REMINDER_CHIP_SX).toMatchObject({
      display: 'inline-flex',
      mx: 0.25,
    })
    expect(REMINDER_CHIP_SX).not.toHaveProperty('width')
  })
})
