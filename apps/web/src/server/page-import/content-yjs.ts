import { TiptapTransformer } from '@hocuspocus/transformer'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

// StarterKit v3 covers paragraph/heading/lists/codeBlock/blockquote/hr/hardBreak
// + bold/italic/code/link marks; Image, task lists, and tables are separate extensions.
const EXTENSIONS = [
  StarterKit,
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
]

export function buildImportContentYjs(content: unknown): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', EXTENSIONS)
  const src = Y.encodeStateAsUpdate(ydoc)
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}
