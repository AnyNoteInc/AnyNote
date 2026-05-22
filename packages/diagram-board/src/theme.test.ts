import { describe, expect, it } from 'vitest'
import { monacoThemeForMode } from './theme'

describe('monacoThemeForMode', () => {
  it('maps dark → vs-dark and light → vs', () => {
    expect(monacoThemeForMode('dark')).toBe('vs-dark')
    expect(monacoThemeForMode('light')).toBe('vs')
  })
})
