import { TiptapTransformer } from '@hocuspocus/transformer'
import Image from '@tiptap/extension-image'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

// StarterKit v3 covers paragraph/heading/lists/codeBlock/blockquote/hr/hardBreak
// + bold/italic/code/link marks; Image and task lists are separate extensions.
const EXTENSIONS = [StarterKit, Image, TaskList, TaskItem.configure({ nested: true })]

export function buildImportContentYjs(content: unknown): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', EXTENSIONS)
  const src = Y.encodeStateAsUpdate(ydoc)
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}
