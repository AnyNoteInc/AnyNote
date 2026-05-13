import { Node } from '@tiptap/core'
import type { NodeSpec } from '@tiptap/pm/model'

// Raw NodeSpecs — exported so unit tests can build a prosemirror-model Schema
// directly without spinning up a Tiptap Editor.
export const columnLayoutSpec: NodeSpec = {
  group: 'block',
  content: 'column+',
  attrs: {
    columns: { default: null },
  },
  defining: true,
  isolating: false,
  parseDOM: [
    {
      tag: 'div[data-type="column-layout"]',
      getAttrs: (dom) => ({
        columns:
          dom instanceof HTMLElement ? Number(dom.getAttribute('data-columns')) || null : null,
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'column-layout',
      'data-columns': String(node.attrs.columns ?? node.childCount),
      class: 'column-layout',
    },
    0,
  ],
}

export const columnSpec: NodeSpec = {
  content: 'block+',
  isolating: true,
  attrs: {
    width: { default: 1 },
  },
  parseDOM: [
    {
      tag: 'div[data-type="column"]',
      getAttrs: (dom) => {
        const el = dom as { getAttribute?: (key: string) => string | null }
        return {
          width: Number(el.getAttribute?.('data-width')) || 1,
        }
      },
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'column',
      'data-width': String(node.attrs.width),
      class: 'column',
      style: `--column-width: ${node.attrs.width}`,
    },
    0,
  ],
}

// Tiptap Nodes that mirror the specs above. These are the "schema-only"
// extensions consumed by server-side rendering (no NodeView, no plugins).
// The client extension in `column-layout.ts` extends these with the
// appendTransaction dissolve plugin.
export const ColumnLayoutSchema = Node.create({
  name: 'columnLayout',
  group: 'block',
  content: 'column+',
  addAttributes() {
    return {
      columns: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-columns')) || null,
        renderHTML: () => ({}),
      },
    }
  },
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column-layout"]' }]
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'column-layout',
        'data-columns': String(node.attrs.columns ?? node.childCount),
        class: 'column-layout',
      },
      0,
    ]
  },
})

export const ColumnSchema = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  addAttributes() {
    return {
      width: {
        default: 1,
        parseHTML: (element) => Number(element.getAttribute('data-width')) || 1,
        renderHTML: (attrs) => ({
          'data-width': String(attrs.width ?? 1),
          style: `--column-width: ${attrs.width ?? 1}`,
        }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'column',
        'data-width': String(node.attrs.width),
        class: 'column',
        style: `--column-width: ${node.attrs.width}`,
      },
      0,
    ]
  },
})
