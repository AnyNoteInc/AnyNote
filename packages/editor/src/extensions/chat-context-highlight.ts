// Chat-context highlight — keeps the page-chat's selection context VISIBLY
// highlighted while the editor is blurred. Opening the page chat moves focus
// into the composer (its autofocus is deliberate), which erases the native
// selection paint even though ProseMirror's `state.selection` — the range the
// chat actually sends as context — survives. This plugin re-paints that range
// as an inline decoration so the user can see exactly which fragment is in
// context (the inline-ai source-highlight precedent).
//
// Driven from apps/web (page-chat-sidebar) via the `setChatContextHighlight`
// command on the editor it already holds — no deep import needed (the
// `setCommentThreads` precedent). The sidebar re-syncs the range on every
// selectionUpdate while the panel is open and clears it on close, so the
// drift guard here only has to bridge the gaps between updates.
//
// Yjs hardening (the inline-ai.ts twin): remote Yjs updates — INCLUDING the
// page-chat agent's own engines-side page writes, this feature's headline
// flow — arrive as ONE whole-document ReplaceStep; tr.mapping through it
// expands the range to [0, docEnd] and the whole page turns "highlighted".
// The range is therefore also anchored as Yjs RelativePositions and
// re-RESOLVED (not mapped) on transactions carrying the ySync meta. Without a
// collab binding the anchors are absent and plain mapping is used.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type * as Y from 'yjs'
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap'

import { ystate } from '../comment-anchor'

export type ChatContextHighlightRange = { from: number; to: number } | null

type HighlightState = {
  from: number
  to: number
  /** Yjs anchors — survive y-prosemirror's whole-doc remote re-syncs. */
  relFrom?: Y.RelativePosition | null
  relTo?: Y.RelativePosition | null
} | null

export const chatContextHighlightPluginKey = new PluginKey<HighlightState>('chatContextHighlight')

const HIGHLIGHT_CLASS = 'anynote-chat-context-highlight'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chatContextHighlight: {
      /** Highlight [from,to] as the page-chat context; null clears. */
      setChatContextHighlight: (range: ChatContextHighlightRange) => ReturnType
    }
  }
}

const sameRange = (a: HighlightState, b: ChatContextHighlightRange): boolean =>
  (a === null && b === null) || (a?.from === b?.from && a?.to === b?.to)

/** Anchor {from,to} in the Yjs doc (null anchors without a collab binding). */
const withYjsAnchors = (
  range: { from: number; to: number },
  state: EditorState,
): HighlightState => {
  const st = ystate(state)
  if (!st) return range
  try {
    return {
      ...range,
      relFrom: absolutePositionToRelativePosition(range.from, st.type, st.binding.mapping),
      relTo: absolutePositionToRelativePosition(range.to, st.type, st.binding.mapping),
    }
  } catch {
    return range
  }
}

/** Remote Yjs sync: re-resolve the anchors. 'inapplicable' → not a ySync tr /
 *  no anchors (take the mapping path); 'orphaned' → the anchored content was
 *  deleted remotely (clear the highlight — mapping a whole-doc ReplaceStep
 *  would corrupt the range to [0, docEnd] and paint the entire page). */
const resolveFromAnchors = (
  value: NonNullable<HighlightState>,
  tr: Transaction,
  newState: EditorState,
): NonNullable<HighlightState> | 'inapplicable' | 'orphaned' => {
  if (!tr.getMeta(ySyncPluginKey) || !value.relFrom || !value.relTo) return 'inapplicable'
  const st = ystate(newState)
  if (!st) return 'inapplicable'
  const from = relativePositionToAbsolutePosition(
    st.doc,
    st.type,
    value.relFrom,
    st.binding.mapping,
  )
  const to = relativePositionToAbsolutePosition(st.doc, st.type, value.relTo, st.binding.mapping)
  if (from == null || to == null || from > to) return 'orphaned'
  return { ...value, from, to }
}

/** Local edits: the inline-ai drift guard — assoc=1, re-bias left on collapse. */
const mapThrough = (
  value: NonNullable<HighlightState>,
  tr: Transaction,
): NonNullable<HighlightState> => {
  const wasNonEmpty = value.to > value.from
  let from = tr.mapping.map(value.from, 1)
  const to = tr.mapping.map(value.to, 1)
  if (wasNonEmpty && from >= to) from = tr.mapping.map(value.from, -1)
  return { ...value, from, to }
}

export const ChatContextHighlight = Extension.create({
  name: 'chatContextHighlight',

  addCommands() {
    return {
      setChatContextHighlight:
        (range) =>
        ({ state, tr, dispatch }) => {
          // Skip the no-op dispatch: the sidebar calls this on every
          // selectionUpdate, and most of those don't move the range.
          // `preventDispatch` stops Tiptap from dispatching the (empty) tr —
          // note it suppresses the WHOLE chain, so keep this command
          // standalone (the sidebar does).
          const current = chatContextHighlightPluginKey.getState(state) ?? null
          if (sameRange(current, range)) {
            tr.setMeta('preventDispatch', true)
            return true
          }
          if (dispatch) dispatch(tr.setMeta(chatContextHighlightPluginKey, { range }))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: chatContextHighlightPluginKey,
        state: {
          init: () => null,
          apply(
            tr: Transaction,
            value: HighlightState,
            _oldState: EditorState,
            newState: EditorState,
          ): HighlightState {
            let next = value
            if (next && tr.docChanged) {
              // Remote Yjs update = whole-doc ReplaceStep → re-RESOLVE the Yjs
              // anchors instead of mapping (they survive by construction);
              // local edits (and anchor-less states) take the mapping path.
              const resolved = resolveFromAnchors(next, tr, newState)
              if (resolved === 'orphaned') next = null
              else if (resolved === 'inapplicable') next = mapThrough(next, tr)
              else next = resolved
            }
            const meta = tr.getMeta(chatContextHighlightPluginKey) as
              { range: ChatContextHighlightRange } | undefined
            if (meta) next = meta.range ? withYjsAnchors(meta.range, newState) : null
            return next
          },
        },
        props: {
          decorations(state): DecorationSet {
            const range = chatContextHighlightPluginKey.getState(state)
            if (!range) return DecorationSet.empty
            const docSize = state.doc.content.size
            // Defensive: a stale range outside the doc — drop, don't throw.
            if (range.from < 0 || range.to > docSize || range.from >= range.to) {
              return DecorationSet.empty
            }
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: HIGHLIGHT_CLASS }),
            ])
          },
        },
      }),
    ]
  },
})
