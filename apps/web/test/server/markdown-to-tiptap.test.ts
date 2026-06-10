import { describe, expect, it } from 'vitest'

import {
  markdownToTiptap,
  parseMarkdownDocument,
} from '../../src/server/page-import/markdown-to-tiptap'

describe('markdownToTiptap', () => {
  it('parses headings with clamped levels', () => {
    const doc = markdownToTiptap('# H1\n\n###### H6')
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(doc.content[1]).toMatchObject({ type: 'heading', attrs: { level: 6 } })
  })

  it('parses nested bullet lists', () => {
    const doc = markdownToTiptap('- a\n  - b')
    expect(doc.content[0]!.type).toBe('bulletList')
    const item = doc.content[0]!.content![0]!
    expect(item.type).toBe('listItem')
    expect(JSON.stringify(item)).toContain('bulletList')
  })

  it('parses GFM task lists into taskList/taskItem with checked attrs', () => {
    const doc = markdownToTiptap('- [ ] open\n- [x] done')
    expect(doc.content[0]!.type).toBe('taskList')
    expect(doc.content[0]!.content![0]).toMatchObject({
      type: 'taskItem',
      attrs: { checked: false },
    })
    expect(doc.content[0]!.content![1]).toMatchObject({
      type: 'taskItem',
      attrs: { checked: true },
    })
  })

  it('parses fenced code blocks with language', () => {
    const doc = markdownToTiptap('```ts\nconst a = 1\n```')
    expect(doc.content[0]).toMatchObject({ type: 'codeBlock', attrs: { language: 'ts' } })
    expect(doc.content[0]!.content![0]!.text).toBe('const a = 1')
  })

  it('parses blockquote and hr', () => {
    const doc = markdownToTiptap('> quote\n\n---')
    expect(doc.content[0]!.type).toBe('blockquote')
    expect(doc.content[1]!.type).toBe('horizontalRule')
  })

  it('parses inline marks: bold, italic, code, link (nested)', () => {
    const doc = markdownToTiptap('**bold _both_** `code` [link](https://example.com)')
    const text = JSON.stringify(doc)
    expect(text).toContain('"type":"bold"')
    expect(text).toContain('"type":"italic"')
    expect(text).toContain('"type":"code"')
    expect(text).toContain('"href":"https://example.com"')
  })

  it('hoists images out of paragraphs as block image nodes', () => {
    const doc = markdownToTiptap('before ![alt](pic.png) after')
    const types = doc.content.map((n) => n.type)
    expect(types).toEqual(['paragraph', 'image', 'paragraph'])
    expect(doc.content[1]).toMatchObject({ type: 'image', attrs: { src: 'pic.png', alt: 'alt' } })
  })

  it('applies resolveImageSrc and keeps original on null', () => {
    const doc = markdownToTiptap('![a](images/a.png)\n\n![b](https://x/b.png)', {
      resolveImageSrc: (src) => (src.startsWith('images/') ? '/api/files/f1' : null),
    })
    expect(doc.content[0]).toMatchObject({ type: 'image', attrs: { src: '/api/files/f1' } })
    expect(doc.content[1]).toMatchObject({ type: 'image', attrs: { src: 'https://x/b.png' } })
  })

  it('parses GFM tables into tiptap table nodes', () => {
    const doc = markdownToTiptap('| a | b |\n|---|---|\n| **1** | 2 |')
    const table = doc.content[0]!
    expect(table.type).toBe('table')
    const rows = table.content!
    expect(rows.length).toBe(2)
    expect(rows[0]!.content![0]!.type).toBe('tableHeader')
    expect(rows[1]!.content![0]!.type).toBe('tableCell')
    const s = JSON.stringify(doc)
    expect(s).toContain('"a"')
    expect(s).toContain('"type":"bold"')
  })

  it('returns an empty doc for blank input', () => {
    expect(markdownToTiptap('  \n ')).toEqual({ type: 'doc', content: [] })
  })
})

describe('parseMarkdownDocument', () => {
  it('extracts a leading H1 as the title and strips it from the body', () => {
    const { title, doc } = parseMarkdownDocument('# Заголовок\n\nТело.', 'fallback')
    expect(title).toBe('Заголовок')
    expect(JSON.stringify(doc)).not.toContain('Заголовок')
    expect(JSON.stringify(doc)).toContain('Тело.')
  })

  it('falls back to the provided title when there is no leading H1', () => {
    const { title } = parseMarkdownDocument('Просто текст', 'Имя файла')
    expect(title).toBe('Имя файла')
  })
})
