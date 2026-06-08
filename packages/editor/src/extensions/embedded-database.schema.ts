import { Node, mergeAttributes } from '@tiptap/core'

// Schema-only definition of the embedded-database block. It is an atom block
// node that references a `DatabaseSource` by id and renders a live inline view
// of that source. The SCHEMA lives here (no React, no MUI, no tRPC) so it can be
// registered in BOTH the client `buildExtensions` (index.ts) AND the server
// `buildServerExtensions` (server.ts). Registering it server-side is load-bearing:
// `generateHTML` / template-preview walks the doc with the server extension set,
// and an unregistered custom node makes it throw (this caused a production crash
// for the columnLayout node before — see project memory).
//
// renderHTML emits a static placeholder div carrying the source/view ids as data
// attributes. The live table is rendered by the client node view (see
// embedded-database.tsx), which apps/web injects via the `renderEmbed` option.
export type EmbeddedDatabaseAttrs = {
  sourceId: string | null
  viewId: string | null
  displayMode: 'table'
  readonly: boolean
}

export const EmbeddedDatabaseSchema = Node.create({
  name: 'embeddedDatabase',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      sourceId: { default: null },
      viewId: { default: null },
      displayMode: { default: 'table' },
      readonly: { default: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embedded-database"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            sourceId: el.getAttribute('data-source-id') || null,
            viewId: el.getAttribute('data-view-id') || null,
            displayMode: 'table',
            readonly: el.getAttribute('data-readonly') === 'true',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as EmbeddedDatabaseAttrs
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'embedded-database',
        'data-source-id': attrs.sourceId ?? '',
        'data-view-id': attrs.viewId ?? '',
        'data-display-mode': attrs.displayMode,
        'data-readonly': String(attrs.readonly),
      }),
      // Static fallback content for SSR/export contexts that don't run the
      // React node view (PDF/HTML export). The live table replaces this in app.
      ['span', { class: 'anynote-embedded-database__label' }, 'База данных'],
    ]
  },
})
