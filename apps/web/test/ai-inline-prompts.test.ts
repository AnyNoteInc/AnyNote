import { describe, expect, it } from 'vitest'

import {
  INLINE_AI_ACTIONS,
  MAX_SELECTION_CHARS,
  buildInlinePrompt,
  isInlineAiAction,
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
