import { Node } from '@tiptap/core'
import type { NodeSpec } from '@tiptap/pm/model'

// Raw NodeSpecs — exported so unit tests can build a prosemirror-model Schema
// directly without spinning up a Tiptap Editor.
export const columnLayoutSpec: NodeSpec = {
  group: 'block',
  content: 'column{1,3}',
  defining: true,
  isolating: false,
  parseDOM: [{ tag: 'div[data-type="column-layout"]' }],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'column-layout',
      'data-columns': String(node.childCount),
      class: `column-layout column-layout--${node.childCount}`,
    },
    0,
  ],
}

export const columnSpec: NodeSpec = {
  content: 'block+',
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="column"]' }],
  toDOM: () => ['div', { 'data-type': 'column', class: 'column' }, 0],
}

// Tiptap Nodes that mirror the specs above. These are the "schema-only"
// extensions consumed by server-side rendering (no NodeView, no plugins).
// The client extension in `column-layout.ts` extends these with the
// appendTransaction dissolve plugin and NodeViews.
export const ColumnLayoutSchema = Node.create({
  name: 'columnLayout',
  group: 'block',
  content: 'column{1,3}',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column-layout"]' }]
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'column-layout',
        'data-columns': String(node.childCount),
        class: `column-layout column-layout--${node.childCount}`,
      },
      0,
    ]
  },
})

export const ColumnSchema = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML() {
    return ['div', { 'data-type': 'column', class: 'column' }, 0]
  },
})
