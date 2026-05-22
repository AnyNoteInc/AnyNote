import { describe, expect, it } from 'vitest'
import { mermaidThemeForMode } from './mermaid-theme'

describe('mermaidThemeForMode', () => {
  it('maps dark → dark and light → default', () => {
    expect(mermaidThemeForMode('dark')).toBe('dark')
    expect(mermaidThemeForMode('light')).toBe('default')
  })
})
