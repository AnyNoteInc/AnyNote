import { describe, expect, it } from 'vitest'
import { MERMAID_LANGUAGE_ID, mermaidMonarchLanguage } from './mermaid-language'

describe('mermaid monarch language', () => {
  it('exposes a stable language id', () => {
    expect(MERMAID_LANGUAGE_ID).toBe('mermaid')
  })

  it('lists the common diagram keywords', () => {
    expect(mermaidMonarchLanguage.keywords).toEqual(
      expect.arrayContaining(['graph', 'sequenceDiagram', 'classDiagram', 'flowchart', 'stateDiagram']),
    )
  })
})
