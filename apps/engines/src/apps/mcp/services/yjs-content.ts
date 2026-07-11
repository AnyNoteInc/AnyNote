import { TiptapTransformer } from '@hocuspocus/transformer'
import { getSchema } from '@tiptap/core'
import { prosemirrorToYXmlFragment } from 'y-prosemirror'
import type * as Y from 'yjs'

import { CONTENT_EXTENSIONS } from './content-yjs.js'

export type TiptapDoc = { type: 'doc'; content?: unknown[] }

/** A content mutation expressed against the page's Tiptap document. */
export type ContentEdit =
  | { kind: 'append'; doc: TiptapDoc }
  | { kind: 'replaceAll'; doc: TiptapDoc }
  | { kind: 'replaceText'; find: string; replace: string; all: boolean }

// One schema instance for parse/validate — the exact extension set the MCP
// writer serializes with (StarterKit + tables), so round-trips are lossless
// for everything the agent can produce.
const schema = getSchema(CONTENT_EXTENSIONS)

/** Current Tiptap JSON of the 'default' fragment of a (possibly live) Y.Doc. */
export function readTiptapDoc(ydoc: Y.Doc): TiptapDoc {
  return TiptapTransformer.fromYdoc(ydoc, 'default') as TiptapDoc
}

/** Target document for `edit` applied to `current`, plus the replacement count
 *  for replaceText edits (0 = «не найдено», caller decides how to report). */
export function computeTargetDoc(
  current: TiptapDoc | null,
  edit: ContentEdit,
): { doc: TiptapDoc; replacements: number } {
  const base: TiptapDoc = current ?? { type: 'doc', content: [] }
  if (edit.kind === 'append') {
    return {
      doc: { type: 'doc', content: [...(base.content ?? []), ...(edit.doc.content ?? [])] },
      replacements: 0,
    }
  }
  if (edit.kind === 'replaceAll') {
    return { doc: { type: 'doc', content: edit.doc.content ?? [] }, replacements: 0 }
  }

  // replaceText: substring replacement WITHIN single text nodes (marks split
  // text into separate nodes — a find spanning formatting boundaries won't
  // match; documented limitation, callers suggest updatePage then).
  let replacements = 0
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node
    const n = node as { type?: unknown; text?: unknown; content?: unknown[] }
    let text: string | undefined
    if (
      n.type === 'text' &&
      typeof n.text === 'string' &&
      (edit.all || replacements === 0) &&
      n.text.includes(edit.find)
    ) {
      if (edit.all) {
        replacements += n.text.split(edit.find).length - 1
        text = n.text.split(edit.find).join(edit.replace)
      } else {
        replacements = 1
        text = n.text.replace(edit.find, edit.replace)
      }
    }
    let content = n.content
    if (Array.isArray(n.content)) {
      const mapped = n.content.map(walk)
      if (mapped.some((child, i) => child !== n.content![i])) content = mapped
    }
    if (text === undefined && content === n.content) return node
    const next = { ...(node as Record<string, unknown>) }
    if (text !== undefined) next.text = text
    if (content !== n.content) next.content = content
    return next
  }
  return { doc: walk(base) as TiptapDoc, replacements }
}

/** Validate `target` against the schema (throws on malformed docs) and return
 *  an applier that diffs the live fragment toward it. Split so validation can
 *  run BEFORE any mutation — a schema error must never leave a half-applied
 *  transaction on a live document. */
export function prepareDocUpdate(target: TiptapDoc): (ydoc: Y.Doc) => void {
  const pmDoc = schema.nodeFromJSON(target)
  pmDoc.check()
  // prosemirrorToYXmlFragment wraps y-prosemirror's updateYFragment — the SAME
  // differ ySyncPlugin runs on every editor keystroke, so an unchanged prefix
  // produces no ops (append stays an append for collaborative undo/merge).
  return (ydoc: Y.Doc) => {
    prosemirrorToYXmlFragment(pmDoc, ydoc.getXmlFragment('default'))
  }
}
