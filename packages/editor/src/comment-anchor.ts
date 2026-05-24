import * as Y from 'yjs'
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

import type { CommentThreadAnchor } from './types-comments'

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export function encodeAnchor(rel: Y.RelativePosition): string {
  return toBase64(Y.encodeRelativePosition(rel))
}
export function decodeAnchor(b64: string): Y.RelativePosition {
  return Y.decodeRelativePosition(fromBase64(b64))
}

// The Y binding mapping type is not exported, so mirror its shape locally to
// type the binding without `any`.
type ProsemirrorMapping = Map<Y.AbstractType<unknown>, PMNode | PMNode[]>
type YState = { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: ProsemirrorMapping } }

function ystate(state: EditorState): YState | null {
  const st = ySyncPluginKey.getState(state) as YState | undefined
  return st?.binding ? st : null
}

/** Current selection → encoded anchor + quoted text. Read-only safe. Null if empty/no-binding. */
export function selectionToAnchor(
  state: EditorState,
): { anchorStart: string; anchorEnd: string; quotedText: string } | null {
  const st = ystate(state)
  if (!st) return null
  const { from, to } = state.selection
  if (from === to) return null
  const relStart = absolutePositionToRelativePosition(from, st.type, st.binding.mapping)
  const relEnd = absolutePositionToRelativePosition(to, st.type, st.binding.mapping)
  return {
    anchorStart: encodeAnchor(relStart),
    anchorEnd: encodeAnchor(relEnd),
    quotedText: state.doc.textBetween(from, to, ' ').slice(0, 2000),
  }
}

/** Encoded anchor → absolute PM range, or null if the anchored text is gone (orphan). */
export function anchorToRange(
  state: EditorState,
  anchor: Pick<CommentThreadAnchor, 'anchorStart' | 'anchorEnd'>,
): { from: number; to: number } | null {
  const st = ystate(state)
  if (!st) return null
  const from = relativePositionToAbsolutePosition(
    st.doc,
    st.type,
    decodeAnchor(anchor.anchorStart),
    st.binding.mapping,
  )
  const to = relativePositionToAbsolutePosition(
    st.doc,
    st.type,
    decodeAnchor(anchor.anchorEnd),
    st.binding.mapping,
  )
  if (from == null || to == null || from >= to) return null
  return { from, to }
}
