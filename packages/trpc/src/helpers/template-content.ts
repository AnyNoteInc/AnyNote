import { TiptapTransformer } from '@hocuspocus/transformer'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import * as Y from 'yjs'

/**
 * Derive Yjs update bytes from a Tiptap/ProseMirror JSON doc so a template
 * saved via the single-user editor stays byte-compatible with how pages store
 * content (createPageFromTemplate copies both content + contentYjs into the new
 * page). The extension set covers what the template editor can produce
 * (StarterKit nodes + task lists). Returns null when content is not a
 * `{ type: 'doc' }` document so the caller can reject the update rather than
 * persist a content/Yjs mismatch.
 */
export function deriveTemplateContentYjs(content: unknown): Uint8Array<ArrayBuffer> | null {
  if (!content || typeof content !== 'object' || (content as { type?: unknown }).type !== 'doc') {
    return null
  }
  try {
    const ydoc = TiptapTransformer.toYdoc(content, 'default', [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
    ])
    const src = Y.encodeStateAsUpdate(ydoc)
    const out = new Uint8Array(new ArrayBuffer(src.byteLength))
    out.set(src)
    return out
  } catch {
    return null
  }
}
