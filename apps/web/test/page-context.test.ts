import { describe, expect, it } from 'vitest'

import {
  buildPageContextAttachment,
  MAX_PAGE_CONTEXT_CHARS,
  parsePageContext,
} from '../src/lib/chat/page-context'

describe('parsePageContext', () => {
  it('returns null for absent input', () => {
    expect(parsePageContext(undefined)).toBeNull()
    expect(parsePageContext(null)).toBeNull()
  })

  it('accepts a valid object', () => {
    expect(parsePageContext({ content: '# Тест', isSelection: false })).toEqual({
      content: '# Тест',
      isSelection: false,
    })
  })

  it.each([
    'string',
    42,
    ['array'],
    { content: '', isSelection: false },
    { content: '   ', isSelection: true },
    { content: 'x', isSelection: 'yes' },
    { isSelection: true },
  ])('rejects invalid input %#', (raw) => {
    expect(parsePageContext(raw)).toEqual({ error: expect.any(String) })
  })
})

describe('buildPageContextAttachment', () => {
  it('builds a markdown attachment named after the page', () => {
    const att = buildPageContextAttachment(
      { content: '# Тело', isSelection: false },
      'Моя страница',
    )
    expect(att).toMatchObject({
      id: 'page-context',
      name: 'Моя страница.md',
      mime: 'text/markdown',
      included: true,
      content: '# Тело',
    })
    expect(att.sizeBytes).toBeGreaterThan(0)
  })

  it('names selection context distinctly', () => {
    const att = buildPageContextAttachment({ content: 'кусок', isSelection: true }, 'Моя страница')
    expect(att.name).toBe('Выделенный фрагмент.md')
  })

  it('truncates over-cap content with a visible marker', () => {
    const att = buildPageContextAttachment(
      { content: 'A'.repeat(MAX_PAGE_CONTEXT_CHARS + 100), isSelection: false },
      'P',
    )
    expect(att.content!.length).toBeLessThanOrEqual(MAX_PAGE_CONTEXT_CHARS + 50)
    expect(att.content).toContain('…контент обрезан')
  })

  it('falls back to a generic name when the title is empty', () => {
    const att = buildPageContextAttachment({ content: 'x', isSelection: false }, '  ')
    expect(att.name).toBe('Страница.md')
  })
})
