import { describe, expect, it } from 'vitest'

import { buildFilename, contentDisposition } from '@/server/page-export/filename'

describe('buildFilename', () => {
  it('uses the trimmed title with the format extension', () => {
    expect(buildFilename('Hello World', 'pdf')).toBe('Hello World.pdf')
    expect(buildFilename('Hello World', 'html')).toBe('Hello World.html')
    expect(buildFilename('Hello World', 'md')).toBe('Hello World.md')
  })

  it('falls back to "Без названия" when the title is null/empty/whitespace', () => {
    expect(buildFilename(null, 'pdf')).toBe('Без названия.pdf')
    expect(buildFilename('', 'pdf')).toBe('Без названия.pdf')
    expect(buildFilename('   ', 'pdf')).toBe('Без названия.pdf')
  })

  it('strips filesystem-unsafe characters', () => {
    expect(buildFilename('a/b\\c:d*e?f"g<h>i|j', 'pdf')).toBe('a b c d e f g h i j.pdf')
  })

  it('collapses runs of whitespace introduced by sanitization', () => {
    expect(buildFilename('foo///bar', 'pdf')).toBe('foo bar.pdf')
  })

  it('truncates the safe stem at 100 chars', () => {
    const stem = 'x'.repeat(150)
    const out = buildFilename(stem, 'pdf')
    expect(out).toBe(`${'x'.repeat(100)}.pdf`)
  })

  it('handles cyrillic titles unchanged', () => {
    expect(buildFilename('Заметка о работе', 'md')).toBe('Заметка о работе.md')
  })
})

describe('contentDisposition', () => {
  it('emits RFC 5987 filename* with UTF-8 encoding', () => {
    expect(contentDisposition('Hello World.pdf')).toBe(
      "attachment; filename*=UTF-8''Hello%20World.pdf",
    )
  })

  it('percent-encodes cyrillic', () => {
    const out = contentDisposition('Заметка.md')
    expect(out.startsWith("attachment; filename*=UTF-8''")).toBe(true)
    expect(out).toContain(encodeURIComponent('Заметка.md'))
  })
})
