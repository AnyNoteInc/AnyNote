import { describe, expect, it } from 'vitest'

import { tiptapJsonToHtml } from '@/server/page-export/tiptap-to-html'

describe('tiptapJsonToHtml', () => {
  it('returns empty string for null/undefined/non-object input', () => {
    expect(tiptapJsonToHtml(null)).toBe('')
    expect(tiptapJsonToHtml(undefined)).toBe('')
    expect(tiptapJsonToHtml('not an object')).toBe('')
  })

  it('renders a paragraph with text', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      ],
    }
    expect(tiptapJsonToHtml(json)).toBe('<p>Hello</p>')
  })

  it('renders headings h1–h3', () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'B' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'C' }] },
      ],
    }
    expect(tiptapJsonToHtml(json)).toBe('<h1>A</h1><h2>B</h2><h3>C</h3>')
  })

  it('renders a callout with emoji', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { emoji: '💡' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }],
        },
      ],
    }
    const html = tiptapJsonToHtml(json)
    expect(html).toContain('data-type="callout"')
    expect(html).toContain('data-emoji="💡"')
    expect(html).toContain('Note')
  })

  it('renders an image', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: '/api/files/abc', alt: 'pic', title: null, width: 100, height: 50 },
        },
      ],
    }
    expect(tiptapJsonToHtml(json)).toContain('src="/api/files/abc"')
  })

  it('renders inline marks (bold, italic, code, link)', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'b' },
            { type: 'text', marks: [{ type: 'italic' }], text: 'i' },
            { type: 'text', marks: [{ type: 'code' }], text: 'c' },
            {
              type: 'text',
              marks: [{ type: 'link', attrs: { href: 'https://x' } }],
              text: 'L',
            },
          ],
        },
      ],
    }
    const html = tiptapJsonToHtml(json)
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<code>c</code>')
    expect(html).toContain('href="https://x"')
  })

  it('renders bulletList, orderedList, taskList', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
          ],
        },
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }],
            },
          ],
        },
      ],
    }
    const html = tiptapJsonToHtml(json)
    expect(html).toContain('<ul>')
    expect(html).toContain('<ol>')
    expect(html).toContain('data-type="taskList"')
  })

  it('renders codeBlock with language attr', () => {
    const json = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1' }],
        },
      ],
    }
    const html = tiptapJsonToHtml(json)
    expect(html).toContain('<pre>')
    expect(html).toContain('const x = 1')
  })
})
