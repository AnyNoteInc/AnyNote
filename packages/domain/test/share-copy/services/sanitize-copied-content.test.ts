import { describe, it, expect } from 'vitest'

import {
  EMBEDDED_DATABASE_COPY_PLACEHOLDER,
  contentHasEmbeddedDatabase,
  sanitizeCopiedContent,
} from '../../../src/share-copy/services/sanitize-copied-content.ts'

const placeholder = {
  type: 'paragraph',
  content: [{ type: 'text', text: EMBEDDED_DATABASE_COPY_PLACEHOLDER }],
}

describe('sanitizeCopiedContent', () => {
  it('replaces a top-level embeddedDatabase node with the placeholder paragraph', () => {
    const input = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        {
          type: 'embeddedDatabase',
          attrs: { sourceId: 'src-1', viewId: 'v-1', displayMode: 'table', readonly: false },
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    }

    const out = sanitizeCopiedContent(input) as typeof input

    expect(out.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      placeholder,
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ])
    // No embeddedDatabase node remains anywhere.
    expect(JSON.stringify(out)).not.toContain('embeddedDatabase')
  })

  it('replaces a nested embeddedDatabase node (inside a column/callout)', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'columnLayout',
          content: [
            {
              type: 'column',
              content: [
                {
                  type: 'embeddedDatabase',
                  attrs: { sourceId: 'nested', viewId: null, displayMode: 'table', readonly: true },
                },
              ],
            },
          ],
        },
      ],
    }

    const out = sanitizeCopiedContent(input) as Record<string, unknown>

    expect(JSON.stringify(out)).not.toContain('embeddedDatabase')
    expect(JSON.stringify(out)).toContain(EMBEDDED_DATABASE_COPY_PLACEHOLDER)
  })

  it('leaves content without embeds unchanged (deep-equal)', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }
    expect(sanitizeCopiedContent(input)).toEqual(input)
  })

  it('returns null content untouched', () => {
    expect(sanitizeCopiedContent(null)).toBeNull()
  })

  it('does not mutate the input', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'embeddedDatabase', attrs: { sourceId: 'x' } }],
    }
    const snapshot = JSON.stringify(input)
    sanitizeCopiedContent(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('contentHasEmbeddedDatabase', () => {
  it('detects a nested embeddedDatabase node', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'callout', content: [{ type: 'embeddedDatabase' }] }],
    }
    expect(contentHasEmbeddedDatabase(input)).toBe(true)
  })

  it('returns false for plain content and null', () => {
    expect(
      contentHasEmbeddedDatabase({ type: 'doc', content: [{ type: 'paragraph' }] }),
    ).toBe(false)
    expect(contentHasEmbeddedDatabase(null)).toBe(false)
  })
})
