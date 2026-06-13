import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

import {
  SYNCED_BLOCK_LABEL,
  SyncedBlockSchema,
  createSyncedBlockNode,
  emptySyncedBlockDoc,
} from './synced-block.schema'

// Build a real prosemirror Schema from the Tiptap NodeSpec (the embedded-database
// precedent — no live Editor needed). StarterKit supplies doc/paragraph/text.
const schema = getSchema([StarterKit, SyncedBlockSchema])

describe('syncedBlock schema', () => {
  it('is an atom block referencing a blockId', () => {
    const type = schema.nodes.syncedBlock
    expect(type).toBeDefined()
    expect(type!.isAtom).toBe(true)
    expect(type!.isBlock).toBe(true)
  })

  it('round-trips the blockId attr through node JSON', () => {
    const node = schema.nodeFromJSON({
      type: 'syncedBlock',
      attrs: { blockId: 'b1b2b3b4-0000-0000-0000-000000000000' },
    })
    expect(() => node.check()).not.toThrow()
    expect(node.attrs.blockId).toBe('b1b2b3b4-0000-0000-0000-000000000000')
    expect(node.toJSON().attrs.blockId).toBe('b1b2b3b4-0000-0000-0000-000000000000')
  })

  it('defaults blockId to null', () => {
    const node = schema.nodes.syncedBlock!.create()
    expect(node.attrs.blockId).toBeNull()
  })

  it('renders a labeled, NON-interactive placeholder server-side (the export fallback)', () => {
    // The server-export path serializes the node via the schema spec's toDOM
    // (derived from the Tiptap renderHTML). Assert it carries the block id, the
    // «Синхронизированный блок» label, and is a plain static <div> + <span>
    // (no editor/iframe surface). toDOM avoids the jsdom dependency of
    // generateHTML (which needs `window`).
    const node = schema.nodeFromJSON({ type: 'syncedBlock', attrs: { blockId: 'abc' } })
    const out = schema.nodes.syncedBlock!.spec.toDOM!(node) as [
      string,
      Record<string, string>,
      [string, Record<string, string>, string],
    ]
    expect(out[0]).toBe('div')
    expect(out[1]['data-type']).toBe('synced-block')
    expect(out[1]['data-block-id']).toBe('abc')
    expect(out[2][0]).toBe('span')
    expect(out[2][2]).toBe(SYNCED_BLOCK_LABEL)
  })

  it('parses the blockId from a data attribute', () => {
    const parsed = schema.nodeFromJSON({ type: 'syncedBlock', attrs: { blockId: 'kept' } })
    expect(parsed.attrs.blockId).toBe('kept')
  })
})

describe('emptySyncedBlockDoc', () => {
  it('is a valid empty tiptap doc with a single paragraph', () => {
    const doc = emptySyncedBlockDoc()
    expect(doc.type).toBe('doc')
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0]!.type).toBe('paragraph')
    // The nested editor's own schema must accept it.
    expect(() => schema.nodeFromJSON(doc).check()).not.toThrow()
  })
})

describe('createSyncedBlockNode', () => {
  it('builds a syncedBlock node JSON carrying the id', () => {
    const node = createSyncedBlockNode('xyz')
    expect(node.type).toBe('syncedBlock')
    expect(node.attrs.blockId).toBe('xyz')
    expect(() => schema.nodeFromJSON(node).check()).not.toThrow()
  })
})
