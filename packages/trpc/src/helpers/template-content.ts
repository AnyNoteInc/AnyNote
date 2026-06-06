import { TiptapTransformer } from '@hocuspocus/transformer'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

/**
 * Derive Yjs update bytes from a Tiptap/ProseMirror JSON doc so a template
 * saved via the single-user editor stays byte-compatible with how pages store
 * content (createPageFromTemplate copies both content + contentYjs into the new
 * page). Returns null when content is not a `{ type: 'doc' }` document.
 */
export function deriveTemplateContentYjs(content: unknown): Uint8Array<ArrayBuffer> | null {
  if (!content || typeof content !== 'object' || (content as { type?: unknown }).type !== 'doc') {
    return null
  }
  try {
    const ydoc = TiptapTransformer.toYdoc(content, 'default', [StarterKit])
    const src = Y.encodeStateAsUpdate(ydoc)
    const out = new Uint8Array(new ArrayBuffer(src.byteLength))
    out.set(src)
    return out
  } catch {
    return null
  }
}
