import { describe, expect, it } from 'vitest'

import { parseHtmlDocument } from '../../src/server/page-import/html-to-tiptap'

describe('parseHtmlDocument', () => {
  it('keeps separate <p> elements as separate paragraphs', () => {
    const { doc } = parseHtmlDocument('<p>Один</p><p>Два</p>', 'f')
    const paras = doc.content.filter((n) => n.type === 'paragraph')
    expect(paras.length).toBe(2)
  })

  it('takes the title from a leading <h1>', () => {
    const { title, doc } = parseHtmlDocument('<h1>Заголовок</h1><p>Тело</p>', 'fallback')
    expect(title).toBe('Заголовок')
    expect(JSON.stringify(doc)).toContain('Тело')
  })

  it('converts lists and inline marks', () => {
    const { doc } = parseHtmlDocument('<ul><li><strong>жирный</strong></li></ul>', 'f')
    expect(doc.content[0]!.type).toBe('bulletList')
    expect(JSON.stringify(doc)).toContain('"type":"bold"')
  })

  it('passes image srcs through the resolver', () => {
    const { doc } = parseHtmlDocument('<p><img src="img/a.png" alt="a"></p>', 'f', {
      resolveImageSrc: () => '/api/files/f9',
    })
    expect(JSON.stringify(doc)).toContain('/api/files/f9')
  })
})
