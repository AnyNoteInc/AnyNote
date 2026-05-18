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
})
