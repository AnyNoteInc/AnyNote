import { describe, it, expect } from 'vitest'

import {
  EMBEDDED_DATABASE_COPY_PLACEHOLDER,
  SYNCED_BLOCK_COPY_PLACEHOLDER,
  contentHasEmbeddedDatabase,
  sanitizeCopiedContent,
} from '../../../src/share-copy/services/sanitize-copied-content.ts'

const placeholder = {
  type: 'paragraph',
  content: [{ type: 'text', text: EMBEDDED_DATABASE_COPY_PLACEHOLDER }],
}

const syncedPlaceholder = {
  type: 'paragraph',
  content: [{ type: 'text', text: SYNCED_BLOCK_COPY_PLACEHOLDER }],
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

// ── Phase 9C: synced-block copy safety (same-ws KEEP vs cross-ws DETACH) ──────
describe('sanitizeCopiedContent — syncedBlock nodes', () => {
  const syncedDoc = () => ({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'syncedBlock', attrs: { blockId: 'block-1' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ],
  })

  it('cross-workspace (default) DETACHES a syncedBlock into the placeholder paragraph', () => {
    const out = sanitizeCopiedContent(syncedDoc()) as ReturnType<typeof syncedDoc>
    expect(out.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      syncedPlaceholder,
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ])
    // No syncedBlock reference (the blockId) leaks across workspaces.
    expect(JSON.stringify(out)).not.toContain('syncedBlock')
    expect(JSON.stringify(out)).not.toContain('block-1')
  })

  it('cross-workspace explicit ({ sameWorkspace: false }) DETACHES', () => {
    const out = sanitizeCopiedContent(syncedDoc(), { sameWorkspace: false }) as ReturnType<
      typeof syncedDoc
    >
    expect(JSON.stringify(out)).not.toContain('syncedBlock')
    expect(JSON.stringify(out)).toContain(SYNCED_BLOCK_COPY_PLACEHOLDER)
  })

  it('same-workspace ({ sameWorkspace: true }) KEEPS the syncedBlock node verbatim', () => {
    const input = syncedDoc()
    const out = sanitizeCopiedContent(input, { sameWorkspace: true }) as typeof input
    // The reference survives — the runtime getById access check is the backstop.
    expect(out.content[1]).toEqual({ type: 'syncedBlock', attrs: { blockId: 'block-1' } })
    expect(JSON.stringify(out)).toContain('block-1')
  })

  it('detaches a nested syncedBlock (inside a column/callout) cross-workspace', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'columnLayout',
          content: [
            { type: 'column', content: [{ type: 'syncedBlock', attrs: { blockId: 'nested' } }] },
          ],
        },
      ],
    }
    const out = sanitizeCopiedContent(input) as Record<string, unknown>
    expect(JSON.stringify(out)).not.toContain('syncedBlock')
    expect(JSON.stringify(out)).not.toContain('nested')
    expect(JSON.stringify(out)).toContain(SYNCED_BLOCK_COPY_PLACEHOLDER)
  })

  it('keeps nested syncedBlock nodes verbatim when same-workspace', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'columnLayout',
          content: [
            { type: 'column', content: [{ type: 'syncedBlock', attrs: { blockId: 'nested' } }] },
          ],
        },
      ],
    }
    const out = sanitizeCopiedContent(input, { sameWorkspace: true }) as Record<string, unknown>
    expect(JSON.stringify(out)).toContain('nested')
  })

  it('still drops embeddedDatabase even when same-workspace (source is never copied)', () => {
    const input = {
      type: 'doc',
      content: [{ type: 'embeddedDatabase', attrs: { sourceId: 'src-1' } }],
    }
    const out = sanitizeCopiedContent(input, { sameWorkspace: true }) as Record<string, unknown>
    expect(JSON.stringify(out)).not.toContain('embeddedDatabase')
    expect(JSON.stringify(out)).toContain(EMBEDDED_DATABASE_COPY_PLACEHOLDER)
  })

  it('does not mutate the input on a cross-workspace detach', () => {
    const input = syncedDoc()
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
