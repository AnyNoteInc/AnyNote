import { Node, mergeAttributes } from '@tiptap/core'

// Schema-only definition of the `syncedBlock` node. It is an ATOM block that
// references a `SyncedBlock` entity by id; its live content lives in a SEPARATE
// `syncedBlock:{id}` Hocuspocus document (NOT in the host page doc). The schema
// lives here (no React, no MUI, no tRPC) so it can be registered in BOTH the
// client `buildExtensions` (index.ts) AND the server `buildServerExtensions`
// (server.ts). Registering it server-side is load-bearing: `generateHTML` /
// template-preview walks the doc with the server extension set, and an
// unregistered custom node makes it throw (the columnLayout production-crash
// precedent — see embedded-database.schema.ts header).
//
// The server renderHTML is NEVER interactive (PDF/HTML can't connect to yjs):
// it renders the injected snapshot label, or a labeled placeholder
// («Синхронизированный блок») fallback. The live nested editor is mounted only
// by the client node view (synced-block.tsx), which apps/web injects via the
// `renderSyncedBlock` option.
export type SyncedBlockAttrs = {
  blockId: string | null
}

export const SYNCED_BLOCK_LABEL = 'Синхронизированный блок'

export const SyncedBlockSchema = Node.create({
  name: 'syncedBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (element) =>
          element instanceof HTMLElement ? element.getAttribute('data-block-id') || null : null,
        renderHTML: (attrs) => {
          const blockId = (attrs as SyncedBlockAttrs).blockId
          return blockId ? { 'data-block-id': blockId } : {}
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="synced-block"]',
      },
    ]
  },

  // Static fallback for SSR/export contexts that don't run the React node view
  // (PDF/HTML export). The live nested editor replaces this in app. The label is
  // ALWAYS «Синхронизированный блок» — the server export path renders the block's
  // snapshot content via the page-export pipeline (it inlines the SyncedBlock
  // snapshot before generateHTML when available; this is the bare fallback).
  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as SyncedBlockAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'synced-block',
        'data-block-id': attrs.blockId ?? '',
        class: 'anynote-synced-block',
      }),
      ['span', { class: 'anynote-synced-block__label' }, SYNCED_BLOCK_LABEL],
    ]
  },
})

// ---------------------------------------------------------------------------
// Pure helpers (no React, no Tiptap Editor) — tested in synced-block.test.ts
// and used by the synced-block.tsx node view / app wiring.
// ---------------------------------------------------------------------------

/**
 * The JSON of a fresh, EMPTY tiptap document — the seed `content` a brand-new
 * synced block is created with (`syncedBlock.create({ content: emptyDoc() })`),
 * and the snapshot the first nested-editor connection fills. Shared by the slash
 * handler + tests so the shape can't drift.
 */
export function emptySyncedBlockDoc() {
  return { type: 'doc' as const, content: [{ type: 'paragraph' as const }] }
}

/**
 * The node JSON inserted into the host page doc once a SyncedBlock id is known.
 * Shared by the slash «создать новый» / «вставить существующий» flows.
 */
export function createSyncedBlockNode(blockId: string) {
  return { type: 'syncedBlock', attrs: { blockId } }
}
