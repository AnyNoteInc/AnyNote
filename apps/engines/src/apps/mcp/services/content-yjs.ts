import { TiptapTransformer } from '@hocuspocus/transformer'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

// StarterKit covers paragraph/heading/lists/codeBlock/blockquote/hr/hardBreak +
// marks; tables are separate extensions, required so MCP-created tables survive
// Yjs serialization (and round-trip back via fromYdoc).
export const CONTENT_EXTENSIONS = [StarterKit, Table, TableRow, TableHeader, TableCell]

export function buildContentYjs(content: unknown): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', CONTENT_EXTENSIONS)
  const src = Y.encodeStateAsUpdate(ydoc)
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}
