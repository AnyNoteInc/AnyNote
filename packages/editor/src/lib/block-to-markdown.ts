import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'

import { htmlToMarkdown } from './html-to-markdown'

// Serializes a single block node through the same renderHTML/toDOM path the
// page-export pipeline uses, so the markdown matches what a full-page export
// would produce for that block. Requires a DOM `document` (browser or
// happy-dom) — callers are client components.
export function blockToMarkdown(schema: Schema, node: PMNode): string {
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(schema).serializeNode(node))
  return htmlToMarkdown(container.innerHTML)
}
