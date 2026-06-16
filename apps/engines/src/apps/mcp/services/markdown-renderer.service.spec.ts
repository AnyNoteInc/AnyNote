import { describe, it, expect } from '@jest/globals'

import { MarkdownRenderer } from './markdown-renderer.service.js'

describe('MarkdownRenderer', () => {
  const renderer = new MarkdownRenderer()

  it('renders empty doc as empty string', () => {
    expect(renderer.render({ type: 'doc', content: [] })).toBe('')
  })

  it('renders paragraph', () => {
    expect(
      renderer.render({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
      }),
    ).toBe('Hello')
  })

  it('renders heading with correct level', () => {
    expect(
      renderer.render({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        ],
      }),
    ).toBe('## Title')
  })

  it('renders marks bold/italic/code/link', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'x', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' y', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' z', marks: [{ type: 'code' }] },
            {
              type: 'text',
              text: ' a',
              marks: [{ type: 'link', attrs: { href: 'https://x' } }],
            },
          ],
        },
      ],
    }
    const rendered = renderer.render(doc)
    expect(rendered).toContain('**x**')
    expect(rendered).toContain('_ y_')
    expect(rendered).toContain('` z`')
    expect(rendered).toContain('[ a](https://x)')
  })

  it('renders bullet list', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
            },
          ],
        },
      ],
    }
    expect(renderer.render(doc)).toBe('- A\n- B')
  })

  it('renders ordered list', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
            },
          ],
        },
      ],
    }
    expect(renderer.render(doc)).toBe('1. A\n2. B')
  })

  it('renders code block with language', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1' }],
        },
      ],
    }
    expect(renderer.render(doc)).toBe('```ts\nconst x = 1\n```')
  })

  it('renders blockquote', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }],
        },
      ],
    }
    expect(renderer.render(doc)).toBe('> quoted')
  })

  it('renders horizontal rule', () => {
    expect(renderer.render({ type: 'doc', content: [{ type: 'horizontalRule' }] })).toBe('---')
  })

  it('renders a table node back to a GFM markdown table', () => {
    const md = renderer.render({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
                },
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }],
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(md).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('escapes pipes and collapses newlines in table cells', () => {
    const md = renderer.render({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }],
                },
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a | b' }] }],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'text', text: 'one' },
                        { type: 'hardBreak' },
                        { type: 'text', text: 'two' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const rows = md.split('\n')
    // 3 rows: header, separator, body. The hardBreak must NOT add a 4th line.
    expect(rows).toHaveLength(3)
    // Literal pipe inside a cell is escaped so it doesn't split the column.
    expect(md).toContain(String.raw`a \| b`)
    // Hard break collapsed (no raw newline inside the body row).
    expect(rows[2]).not.toContain('\n')
    expect(rows[2]).toContain('one')
    expect(rows[2]).toContain('two')
  })
})
