import { describe, expect, it, vi } from 'vitest'
import { PLANTUML_LANGUAGE_ID, registerPlantumlLanguage } from './plantuml-language'

function mockMonaco() {
  const registered: string[] = []
  return {
    languages: {
      getLanguages: () => registered.map((id) => ({ id })),
      register: ({ id }: { id: string }) => {
        registered.push(id)
      },
      setMonarchTokensProvider: vi.fn(),
    },
  } as unknown as typeof import('monaco-editor')
}

describe('registerPlantumlLanguage', () => {
  it('uses the "plantuml" language id', () => {
    expect(PLANTUML_LANGUAGE_ID).toBe('plantuml')
  })

  it('registers the language once (idempotent)', () => {
    const m = mockMonaco()
    registerPlantumlLanguage(m)
    registerPlantumlLanguage(m)
    expect(m.languages.getLanguages().filter((l) => l.id === PLANTUML_LANGUAGE_ID)).toHaveLength(1)
  })
})
