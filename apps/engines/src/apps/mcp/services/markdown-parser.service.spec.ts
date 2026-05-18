import { describe, expect, it } from '@jest/globals'

import { MarkdownParser } from './markdown-parser.service.js'

describe('MarkdownParser', () => {
  const parser = new MarkdownParser()

  it('returns an empty doc for empty / whitespace input', () => {
    expect(parser.parse('')).toEqual({ type: 'doc', content: [] })
    expect(parser.parse('   \n  ')).toEqual({ type: 'doc', content: [] })
  })

  it('parses a single paragraph', () => {
    expect(parser.parse('Hello world')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    })
  })

  it('parses headings 1–6 with level attrs', () => {
    const doc = parser.parse('# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6')
    expect(doc.content).toHaveLength(6)
    doc.content.forEach((node, idx) => {
      expect(node).toMatchObject({
        type: 'heading',
        attrs: { level: idx + 1 },
        content: [{ type: 'text', text: `H${idx + 1}` }],
      })
    })
  })

  it('parses bullet lists', () => {
    const doc = parser.parse('- one\n- two')
    expect(doc.content).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ],
      },
    ])
  })

  it('parses ordered lists', () => {
    const doc = parser.parse('1. first\n2. second')
    expect(doc.content[0]).toMatchObject({
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
      ],
    })
  })

  it('parses blockquotes', () => {
    const doc = parser.parse('> quoted line')
    expect(doc.content).toEqual([
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted line' }] }],
      },
    ])
  })

  it('parses fenced code blocks with language', () => {
    const doc = parser.parse('```ts\nconst x = 1\n```')
    expect(doc.content).toEqual([
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [{ type: 'text', text: 'const x = 1' }],
      },
    ])
  })

  it('parses fenced code blocks without language', () => {
    const doc = parser.parse('```\nplain\n```')
    expect(doc.content).toEqual([
      {
        type: 'codeBlock',
        attrs: {},
        content: [{ type: 'text', text: 'plain' }],
      },
    ])
  })

  it('parses horizontal rules', () => {
    const doc = parser.parse('---')
    expect(doc.content).toEqual([{ type: 'horizontalRule' }])
  })

  it('parses bold marks', () => {
    const doc = parser.parse('**bold**')
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
    })
  })

  it('parses italic marks', () => {
    const doc = parser.parse('_italic_')
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'italic', marks: [{ type: 'italic' }] }],
    })
  })

  it('parses inline code marks', () => {
    const doc = parser.parse('use `npm` here')
    expect(doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'use ' },
        { type: 'text', text: 'npm', marks: [{ type: 'code' }] },
        { type: 'text', text: ' here' },
      ],
    })
  })

  it('parses link marks with href attr', () => {
    const doc = parser.parse('see [docs](https://example.com) please')
    expect(doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'see ' },
        { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'text', text: ' please' },
      ],
    })
  })

  it('stacks nested marks (bold + italic)', () => {
    const doc = parser.parse('**_both_**')
    const para = doc.content[0]
    expect(para.type).toBe('paragraph')
    const text = para.content?.[0]
    expect(text?.text).toBe('both')
    const markTypes = (text?.marks ?? []).map((m) => m.type).sort()
    expect(markTypes).toEqual(['bold', 'italic'])
  })

  it('parses hard breaks inside paragraphs', () => {
    // Markdown hard break = two trailing spaces + newline
    const doc = parser.parse('line one  \nline two')
    expect(doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'hardBreak' },
        { type: 'text', text: 'line two' },
      ],
    })
  })

  it('preserves escaped markdown characters as literal text', () => {
    // marked emits each escaped character as its own text token, so the parser
    // produces multiple text nodes whose combined text equals the unescaped string.
    const doc = parser.parse('\\*not bold\\*')
    const para = doc.content[0]
    expect(para.type).toBe('paragraph')
    const combined = (para.content ?? []).map((n) => n.text ?? '').join('')
    expect(combined).toBe('*not bold*')
  })

  it('downgrades images to their alt text (images are a non-goal)', () => {
    const doc = parser.parse('![alt text](https://example.com/img.png)')
    expect(doc.content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'alt text' }],
    })
  })

  it('preserves accumulated marks on hard breaks inside marked spans', () => {
    const doc = parser.parse('**line one  \nline two**')
    // Expect: text(bold) + hardBreak(bold) + text(bold) all inside one paragraph.
    const para = doc.content[0]
    expect(para.type).toBe('paragraph')
    const nodes = para.content ?? []
    expect(nodes).toHaveLength(3)
    expect(nodes[0]).toMatchObject({
      type: 'text',
      text: 'line one',
      marks: [{ type: 'bold' }],
    })
    expect(nodes[1]).toMatchObject({
      type: 'hardBreak',
      marks: [{ type: 'bold' }],
    })
    expect(nodes[2]).toMatchObject({
      type: 'text',
      text: 'line two',
      marks: [{ type: 'bold' }],
    })
  })

  it('round-trips through MarkdownRenderer for supported nodes', async () => {
    const { MarkdownRenderer } = await import('./markdown-renderer.service.js')
    const renderer = new MarkdownRenderer()

    const markdown = [
      '# Heading 1',
      '',
      'A paragraph with **bold**, _italic_, `code` and a [link](https://ex.com).',
      '',
      '## Sub',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '---',
    ].join('\n')

    const doc = parser.parse(markdown)
    const rendered = renderer.render(doc)

    // Renderer output should re-parse back to the same doc.
    expect(parser.parse(rendered)).toEqual(doc)
  })
})
