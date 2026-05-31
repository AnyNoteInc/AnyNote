import { describe, expect, it } from 'vitest'

import { createAppTheme } from '../src/theme/theme'

describe('createAppTheme — Claude cream palette', () => {
  describe('light mode', () => {
    const theme = createAppTheme('light')

    it('uses the cream canvas for background.default', () => {
      expect(theme.palette.background.default.toLowerCase()).toBe('#faf9f5')
    })

    it('keeps paper surfaces pure white', () => {
      expect(theme.palette.background.paper.toLowerCase()).toBe('#ffffff')
    })

    it('uses the coral/rust accent as primary', () => {
      expect(theme.palette.primary.main.toLowerCase()).toBe('#bd5d3a')
    })

    it('keeps primary contrast text legible (white on coral)', () => {
      expect(theme.palette.primary.contrastText.toLowerCase()).toBe('#ffffff')
    })

    it('uses warm ink for primary text', () => {
      expect(theme.palette.text.primary.toLowerCase()).toBe('#3d3d3a')
    })
  })

  describe('dark mode', () => {
    const theme = createAppTheme('dark')

    it('uses the warm-dark canvas for background.default', () => {
      expect(theme.palette.background.default.toLowerCase()).toBe('#262624')
    })

    it('uses the warm-dark elevated surface for background.paper', () => {
      expect(theme.palette.background.paper.toLowerCase()).toBe('#2f2f2c')
    })

    it('keeps the coral/rust accent as primary', () => {
      expect(theme.palette.primary.main.toLowerCase()).toBe('#bd5d3a')
    })

    it('uses warm light ink for primary text', () => {
      expect(theme.palette.text.primary.toLowerCase()).toBe('#e8e4da')
    })
  })
})
