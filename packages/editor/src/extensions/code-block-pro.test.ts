import { describe, expect, it } from 'vitest'
import { buildCodeBlockLowlight, CODE_BLOCK_LANGUAGES } from './code-block-pro'

describe('code block languages', () => {
  it('registers exactly the four supported highlight languages', () => {
    const lowlight = buildCodeBlockLowlight()
    const registered = lowlight.listLanguages()
    expect(registered.sort()).toEqual(['bash', 'javascript', 'python', 'typescript'])
  })

  it('exposes mermaid + the four languages in the selector list', () => {
    expect(CODE_BLOCK_LANGUAGES.map((l) => l.value).sort()).toEqual([
      'bash',
      'javascript',
      'mermaid',
      'python',
      'typescript',
    ])
  })
})
