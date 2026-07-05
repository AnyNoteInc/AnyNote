// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { blockToMarkdown } from './block-to-markdown'

// Real StarterKit schema so toDOM output matches what the live editor produces.
const schema = getSchema([StarterKit])

type JSONNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string }[]
  content?: JSONNode[]
}

const node = (json: JSONNode) => schema.nodeFromJSON(json)

describe('blockToMarkdown', () => {
  it('serializes a heading to ATX markdown', () => {
    const heading = node({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Заголовок' }],
    })
    expect(blockToMarkdown(schema, heading)).toBe('## Заголовок\n')
  })

  it('serializes a bullet list with dash markers', () => {
    const list = node({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Один' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Два' }] }],
        },
      ],
    })
    const md = blockToMarkdown(schema, list)
    // turndown pads after the marker; assert marker + text, not exact spacing
    expect(md).toMatch(/^-\s+Один$/m)
    expect(md).toMatch(/^-\s+Два$/m)
  })

  it('keeps inline marks (bold) as markdown', () => {
    const para = node({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'обычный ' },
        { type: 'text', text: 'жирный', marks: [{ type: 'bold' }] },
      ],
    })
    expect(blockToMarkdown(schema, para)).toBe('обычный **жирный**\n')
  })

  it('serializes a code block as fenced', () => {
    // Stock StarterKit codeBlock — the live editor swaps it for CodeBlockLowlight,
    // but both emit the same `pre > code` toDOM shell that turndown fences.
    const code = node({
      type: 'codeBlock',
      content: [{ type: 'text', text: 'const x = 1' }],
    })
    const md = blockToMarkdown(schema, code)
    expect(md).toContain('```')
    expect(md).toContain('const x = 1')
  })
})
