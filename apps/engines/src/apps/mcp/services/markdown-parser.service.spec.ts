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
})
