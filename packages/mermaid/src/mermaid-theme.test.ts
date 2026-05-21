import { describe, expect, it } from 'vitest'
import { mermaidThemeForMode, monacoThemeForMode } from './mermaid-theme'

describe('theme mapping', () => {
  it('maps dark mode to mermaid "dark" and monaco "vs-dark"', () => {
    expect(mermaidThemeForMode('dark')).toBe('dark')
    expect(monacoThemeForMode('dark')).toBe('vs-dark')
  })

  it('maps light mode to mermaid "default" and monaco "vs"', () => {
    expect(mermaidThemeForMode('light')).toBe('default')
    expect(monacoThemeForMode('light')).toBe('vs')
  })
})
