import { describe, expect, it, vi } from 'vitest'
import { LIKEC4_LANGUAGE_ID, registerLikec4Language } from './likec4-language'

function fakeMonaco() {
  const registered: string[] = []
  return {
    languages: {
      getLanguages: () => registered.map((id) => ({ id })),
      register: ({ id }: { id: string }) => registered.push(id),
      setMonarchTokensProvider: vi.fn(),
    },
  } as unknown as typeof import('monaco-editor')
}

describe('registerLikec4Language', () => {
  it('exposes the language id', () => {
    expect(LIKEC4_LANGUAGE_ID).toBe('likec4')
  })

  it('registers the language and a tokens provider', () => {
    const m = fakeMonaco()
    registerLikec4Language(m)
    expect(m.languages.getLanguages().some((l) => l.id === 'likec4')).toBe(true)
    expect(m.languages.setMonarchTokensProvider).toHaveBeenCalledWith('likec4', expect.anything())
  })

  it('is idempotent (does not double-register)', () => {
    const m = fakeMonaco()
    registerLikec4Language(m)
    registerLikec4Language(m)
    const count = m.languages.getLanguages().filter((l) => l.id === 'likec4').length
    expect(count).toBe(1)
  })
})
