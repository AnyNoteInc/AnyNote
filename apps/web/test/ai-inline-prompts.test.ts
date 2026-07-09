import { describe, expect, it } from 'vitest'

import {
  INLINE_AI_ACTIONS,
  MAX_SELECTION_CHARS,
  buildInlinePrompt,
  isInlineAiAction,
  buildCustomPrompt,
  buildGeneratePrompt,
  isExtendedInlineAiAction,
  MAX_CONTEXT_BEFORE_CHARS,
  MAX_CUSTOM_INSTRUCTION_CHARS,
  MAX_INSTRUCTION_CHARS,
} from '../src/lib/ai/inline-prompts'

describe('inline-ai prompts', () => {
  it('action allow-list is exactly the six presets', () => {
    expect(Object.keys(INLINE_AI_ACTIONS).sort()).toEqual(
      ['expand', 'grammar', 'rewrite', 'shorten', 'summarize', 'translate'].sort(),
    )
  })

  it('isInlineAiAction accepts each preset and rejects unknown', () => {
    expect(isInlineAiAction('summarize')).toBe(true)
    expect(isInlineAiAction('translate')).toBe(true)
    expect(isInlineAiAction('expand')).toBe(true)
    expect(isInlineAiAction('hack')).toBe(false)
    expect(isInlineAiAction('')).toBe(false)
    expect(isInlineAiAction('__proto__')).toBe(false)
    expect(isInlineAiAction('toString')).toBe(false)
  })

  it('buildInlinePrompt embeds the selected text and the preset instruction', () => {
    const p = buildInlinePrompt('summarize', 'Длинный текст про котов.', {})
    expect(p).toContain('Длинный текст про котов.')
    expect(p.toLowerCase()).toMatch(/сократ|кратк|summar|резюм/)
  })

  it('translate uses the targetLang and keeps the source text', () => {
    const p = buildInlinePrompt('translate', 'Привет', { targetLang: 'English' })
    expect(p).toContain('English')
    expect(p).toContain('Привет')
  })

  it('translate falls back to a default language when targetLang is blank', () => {
    const p = buildInlinePrompt('translate', 'Привет', { targetLang: '   ' })
    expect(p).not.toContain('{targetLang}')
  })

  it('caps the selected text at MAX_SELECTION_CHARS', () => {
    const huge = 'я'.repeat(50_000)
    const p = buildInlinePrompt('rewrite', huge, {})
    // The transformed selection must be truncated; the whole prompt stays bounded.
    expect(p.length).toBeLessThan(MAX_SELECTION_CHARS + 2_000)
    // The instruction is still present.
    expect(p.toLowerCase()).toMatch(/перепиш|rewrite|ясно/)
  })
})

describe('extended inline AI actions', () => {
  it('recognises only custom and generate', () => {
    expect(isExtendedInlineAiAction('custom')).toBe(true)
    expect(isExtendedInlineAiAction('generate')).toBe(true)
    expect(isExtendedInlineAiAction('summarize')).toBe(false)
    expect(isExtendedInlineAiAction('__proto__')).toBe(false)
    expect(isExtendedInlineAiAction('')).toBe(false)
  })

  it('buildGeneratePrompt embeds instruction and demands markdown-only output', () => {
    const prompt = buildGeneratePrompt('сделай базу данных в mermaid', {})
    expect(prompt).toContain('сделай базу данных в mermaid')
    expect(prompt).toContain('ТОЛЬКО итоговый markdown')
    expect(prompt).not.toContain('Контекст страницы')
  })

  it('buildGeneratePrompt embeds trimmed page context when present', () => {
    const prompt = buildGeneratePrompt('продолжи текст', { contextBefore: 'Русская баня — это...' })
    expect(prompt).toContain('Контекст страницы')
    expect(prompt).toContain('Русская баня — это...')
  })

  it('buildGeneratePrompt keeps the TAIL of an over-long context', () => {
    const context = 'A'.repeat(MAX_CONTEXT_BEFORE_CHARS) + 'TAIL'
    const prompt = buildGeneratePrompt('продолжи', { contextBefore: context })
    expect(prompt).toContain('TAIL')
    expect(prompt.length).toBeLessThan(MAX_CONTEXT_BEFORE_CHARS + 1_000)
  })

  it('buildGeneratePrompt caps the instruction', () => {
    const prompt = buildGeneratePrompt('И'.repeat(MAX_INSTRUCTION_CHARS + 500), {})
    expect(prompt.length).toBeLessThan(MAX_INSTRUCTION_CHARS + 1_000)
  })

  it('buildCustomPrompt wraps selection in triple quotes with the instruction', () => {
    const prompt = buildCustomPrompt('сделай списком', 'один два три')
    expect(prompt).toContain('сделай списком')
    expect(prompt).toContain('"""\nодин два три\n"""')
    expect(prompt).toContain('Выведи только результат без пояснений.')
  })

  it('buildCustomPrompt caps instruction and selection', () => {
    const prompt = buildCustomPrompt(
      'X'.repeat(MAX_CUSTOM_INSTRUCTION_CHARS + 100),
      'Y'.repeat(9_000),
    )
    expect(prompt).not.toContain('X'.repeat(MAX_CUSTOM_INSTRUCTION_CHARS + 1))
    expect(prompt).not.toContain('Y'.repeat(8_001))
  })
})
