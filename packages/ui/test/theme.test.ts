import { describe, expect, it } from 'vitest'

import { createAppTheme } from '../src/theme/theme'

describe('createAppTheme', () => {
  it('keeps the light app canvas lighter than the previous warm background', () => {
    const theme = createAppTheme('light')

    expect(theme.palette.background.default).toBe('#fffdf7')
    expect(theme.palette.background.paper).toBe('#ffffff')
  })

  it('does not change the dark theme background colors', () => {
    const theme = createAppTheme('dark')

    expect(theme.palette.background.default).toBe('#1d1d1b')
    expect(theme.palette.background.paper).toBe('#2a2a27')
  })
})
