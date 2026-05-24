import { describe, expect, test } from 'vitest'

import { getDrawioThemeParameters } from './theme'

describe('getDrawioThemeParameters', () => {
  test('uses the default draw.io UI for light site theme', () => {
    expect(getDrawioThemeParameters('light')).toEqual({ ui: 'kennedy', dark: false })
  })

  test('uses the dark draw.io UI for dark site theme', () => {
    expect(getDrawioThemeParameters('dark')).toEqual({ ui: 'dark', dark: true })
  })
})
