// Inline AI — the editor surface for the selection bubble-menu «Спросить AI»
// (spec §4.2/§4.3, §7 invariant 5). The streaming result of a preset transform
// is shown as a LOCAL ProseMirror decoration — it is NEVER written to Yjs while
// streaming, so it never pollutes collaboration or the undo stack, and never
// streams partial tokens to other collaborators. The document stays byte-
// identical until the user clicks «Принять», at which point exactly ONE
// transaction mutates the doc (= one collaborative-undo step; StarterKit undo is
// off, the Yjs UndoManager owns undo — see collaboration.ts).
//
// This is modeled exactly on collapsible-headings.ts (the local-decoration
// precedent: a PluginKey, a plugin state, setMeta-driven transitions, a
// decorations prop) and synced-block.tsx (the lazy current-state apply + the
// single chain()-transaction accept).
//
// Position handling — THE DRIFT GUARD: the pending range {from,to} is stored as
// raw numbers and re-mapped through `tr.mapping.map(...)` on EVERY transaction
// while a preview is active. A remote Yjs edit before the selection shifts those
// offsets (the image-paste 4→204 drift documented in MEMORY); without re-mapping
// the accept would delete the wrong range. Accept always uses the CURRENT mapped
// range from plugin state, never a numeric offset captured at popover-open time.
//
// Yjs hardening: `tr.mapping` is blind to how y-prosemirror applies REMOTE
// updates — every remote sync lands as ONE whole-document ReplaceStep
// (sync-plugin `_typeChanged`: `tr.replace(0, doc.content.size, …)`), and
// mapping an interior position through that step collapses the range to
// [0, docEnd]. So alongside the raw numbers the plugin anchors the range as
// Yjs RelativePositions (the comment-anchor precedent) and, on transactions
// carrying the ySync meta, re-RESOLVES the anchors instead of mapping.
// Without a collab binding (pure tests, plain editors) the anchors are simply
// absent and the mapping path is used unchanged.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/core'
import type * as Y from 'yjs'
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap'

import { ystate } from '../comment-anchor'
import { markdownToHtml } from '../lib/markdown-to-html'

// --- public types -----------------------------------------------------------

/** Status of the streaming preview while a transform is in flight or settled.
 *  'capturing' = the ask-AI popover is open over a held selection: the source
 *  range is highlighted and drift-tracked, but no stream has started and no
 *  preview widget is shown. */
export type InlineAiStatus = 'capturing' | 'streaming' | 'done' | 'error'

/** The local (per-viewer) preview state held by the plugin, keyed by PluginKey. */
export type InlineAiPreviewState = {
  /** True while a preview is shown (streaming, done, or error). */
  active: boolean
  /** Start of the pending source range — re-mapped on every transaction. */
  from: number
  /** End of the pending source range — re-mapped on every transaction. */
  to: number
  /** The preset action driving this preview (e.g. 'summarize'/'expand'). */
  action: string
  /** The accumulated streamed text (the preview body). */
  text: string
  /** Streaming lifecycle status. */
  status: InlineAiStatus
  /** A user-facing error message when status === 'error'. */
  error?: string
  /** Yjs anchor of `from` — survives y-prosemirror's whole-doc remote re-syncs.
   *  Absent without a collab binding (plain editors, pure tests). */
  relFrom?: Y.RelativePosition | null
  /** Yjs anchor of `to` (see relFrom). */
  relTo?: Y.RelativePosition | null
}

const INACTIVE: InlineAiPreviewState = {
  active: false,
  from: 0,
  to: 0,
  action: '',
  text: '',
  status: 'done',
}

// --- the meta-action union --------------------------------------------------
//
// Transitions are driven by setMeta(inlineAiPluginKey, meta) — exactly the
// collapsible-headings / comments precedent. Helper constructors keep call sites
// (the popover, the apps/web wiring) honest and the union closed.

type InlineAiMeta =
  | { type: 'capture'; from: number; to: number }
  | { type: 'start'; from: number; to: number; action: string }
  | { type: 'appendToken'; token: string }
  | { type: 'finish' }
  | { type: 'fail'; error: string }
  | { type: 'clear' }

/** Hold [from,to] while the ask-AI popover is open: highlight + drift-track the
 *  selection (the popover-open gap was previously untracked — a remote edit in
 *  that window aimed the preview at the wrong range). */
export const inlineAiCaptureMeta = (args: { from: number; to: number }): InlineAiMeta => ({
  type: 'capture',
  from: args.from,
  to: args.to,
})

/** Begin a preview over [from,to] for `action` with empty streamed text. */
export const inlineAiStartMeta = (args: {
  from: number
  to: number
  action: string
}): InlineAiMeta => ({ type: 'start', from: args.from, to: args.to, action: args.action })

/** Append a streamed token to the accumulated preview text. */
export const inlineAiAppendTokenMeta = (token: string): InlineAiMeta => ({
  type: 'appendToken',
  token,
})

/** Mark the stream complete (status → 'done'), keeping the text + range. */
export const inlineAiFinishMeta = (): InlineAiMeta => ({ type: 'finish' })

/** Mark the stream failed (status → 'error') with a user-facing message. */
export const inlineAiFailMeta = (error: string): InlineAiMeta => ({ type: 'fail', error })

/** Discard the preview — back to inactive, the doc untouched. */
export const inlineAiClearMeta = (): InlineAiMeta => ({ type: 'clear' })

// --- the plugin -------------------------------------------------------------

export const inlineAiPluginKey = new PluginKey<InlineAiPreviewState>('inlineAi')

const PREVIEW_CLASS = 'anynote-inline-ai-preview'
const SOURCE_CLASS = 'anynote-inline-ai-source'

/** Apply a meta on top of the prior state (pure state-machine step). */
const applyMeta = (value: InlineAiPreviewState, meta: InlineAiMeta): InlineAiPreviewState => {
  switch (meta.type) {
    case 'capture':
      return {
        active: true,
        from: meta.from,
        to: meta.to,
        action: '',
        text: '',
        status: 'capturing',
      }
    case 'start':
      return {
        active: true,
        from: meta.from,
        to: meta.to,
        action: meta.action,
        text: '',
        status: 'streaming',
      }
    case 'appendToken':
      if (!value.active) return value
      return { ...value, text: value.text + meta.token }
    case 'finish':
      if (!value.active) return value
      return { ...value, status: 'done' }
    case 'fail':
      if (!value.active) return value
      return { ...value, status: 'error', error: meta.error }
    case 'clear':
      return INACTIVE
  }
}

/**
 * Optional view hook — apps/web injects a renderer for the preview toolbar so
 * the accept/retry/discard buttons + the streaming body can be MUI components,
 * without @repo/editor importing apps/web. The plugin itself only needs the
 * function for the widget DOM; the pure state transitions above don't use it.
 */
export type InlineAiRenderPreview = (args: {
  state: InlineAiPreviewState
  editor: Editor
}) => HTMLElement

/** Build the decoration set for an active preview (pure over state). */
const buildDecorations = (
  state: EditorState,
  preview: InlineAiPreviewState,
  renderPreview: InlineAiRenderPreview | null,
  editor: Editor | null,
): DecorationSet => {
  if (!preview.active) return DecorationSet.empty
  const docSize = state.doc.content.size
  // Defensive: a stale range that fell outside the doc (e.g. the whole section
  // was deleted) — drop the decoration rather than throw.
  if (preview.from < 0 || preview.to > docSize || preview.from > preview.to) {
    return DecorationSet.empty
  }
  const decos: Decoration[] = []
  // Mark the pending source range so it reads as "being transformed".
  if (preview.to > preview.from) {
    decos.push(Decoration.inline(preview.from, preview.to, { class: SOURCE_CLASS }))
  }
  // While the ask-AI popover merely HOLDS the selection (no stream yet), paint
  // only the source highlight — the preview widget appears at 'start'.
  if (preview.status === 'capturing') {
    return DecorationSet.create(state.doc, decos)
  }
  // The preview/toolbar widget sits just after the selection (at `to`).
  decos.push(
    Decoration.widget(
      preview.to,
      () => {
        if (renderPreview && editor) {
          return renderPreview({ state: preview, editor })
        }
        // Fallback DOM box (SSR / unconfigured host / pure tests-of-rendering).
        const box = document.createElement('span')
        box.className = PREVIEW_CLASS
        box.dataset.status = preview.status
        box.contentEditable = 'false'
        box.textContent = preview.text
        return box
      },
      // STABLE widget identity: the key flips ONLY on discrete status
      // transitions (streaming → done/error), never per appended token. Keying
      // on `text.length` (as before) made ProseMirror's view diff treat every
      // token as a NEW widget — `WidgetType.eq` is key-equality, so a changing
      // key fails `matchesWidget` and tears down + rebuilds the widget DOM node
      // each token. Once Task 4 injects the MUI accept/retry/discard toolbar via
      // `renderPreview`, that teardown would destroy+remount the React subtree
      // per token (lost focus/hover/press, flicker). A stable key keeps the host
      // node mounted across the whole stream; the injected renderer updates its
      // OWN subtree from live plugin state. (Mirrors collapsible-headings, which
      // keys on stable identity + a discrete state flag, never content length.)
      // NB: the fallback `<span>` below paints `preview.text` in toDOM; with a
      // reused node toDOM is not re-invoked, so the fallback box reflects the
      // text at first render of each status — fine for SSR/tests; the production
      // path is the injected renderer.
      { side: 1, ignoreSelection: true, key: `inline-ai:${preview.status}` },
    ),
  )
  return DecorationSet.create(state.doc, decos)
}

/**
 * The InlineAI ProseMirror plugin. `editor`/`renderPreview` are passed by the
 * Extension's addProseMirrorPlugins so the widget can render the app-injected
 * toolbar; the exported singleton `inlineAiPlugin` (renderer-less) is what the
 * pure tests drive.
 */
/** The tr.mapping drift step (local edits): assoc=1 with the collapse guard. */
const mapRangeThrough = (value: InlineAiPreviewState, tr: Transaction): InlineAiPreviewState => {
  // Re-map the pending range through this tr. Default bias assoc=1 keeps a
  // plain insertion BEFORE/AT `from` shifting the whole range right (the
  // collaborator-edits-before-selection case the pure tests pin).
  const wasNonEmpty = value.to > value.from
  let mappedFrom = tr.mapping.map(value.from, 1)
  const mappedTo = tr.mapping.map(value.to, 1)
  // COLLAPSE GUARD: a Yjs sync that re-materializes the paragraph as
  // delete-then-reinsert (the empty-page contentYjs sync racing the
  // `start` meta) maps a non-empty range to a degenerate [end,end] with
  // assoc=1 on `from` — the start binds to the END of the reinsertion.
  // When the mapping collapses a previously non-empty range, re-bias
  // `from` LEFT (assoc=-1) so it sticks to the start of the reinserted
  // content. Without this, accept appends at the doc end instead of
  // replacing the selection.
  if (wasNonEmpty && mappedFrom >= mappedTo) {
    mappedFrom = tr.mapping.map(value.from, -1)
  }
  return { ...value, from: mappedFrom, to: mappedTo }
}

/** Anchor the CURRENT {from,to} as Yjs RelativePositions (null without a
 *  collab binding — plain editors and the pure tests keep mapping-only). */
const withYjsAnchors = (value: InlineAiPreviewState, state: EditorState): InlineAiPreviewState => {
  const st = ystate(state)
  if (!st) return value
  try {
    return {
      ...value,
      relFrom: absolutePositionToRelativePosition(value.from, st.type, st.binding.mapping),
      relTo: absolutePositionToRelativePosition(value.to, st.type, st.binding.mapping),
    }
  } catch {
    return value
  }
}

export const createInlineAiPlugin = (opts: {
  renderPreview: InlineAiRenderPreview | null
  editor: Editor | null
}): Plugin<InlineAiPreviewState> =>
  new Plugin<InlineAiPreviewState>({
    key: inlineAiPluginKey,
    state: {
      init: () => INACTIVE,
      apply(
        tr: Transaction,
        value: InlineAiPreviewState,
        _oldState: EditorState,
        newState: EditorState,
      ): InlineAiPreviewState {
        // 1. THE DRIFT GUARD — keep the stored range pointing at the same
        //    content on every doc-changing transaction while active.
        let next = value
        if (value.active && tr.docChanged) {
          // A remote Yjs update arrives as ONE whole-document ReplaceStep
          // (y-prosemirror sync-plugin) — tr.mapping through it collapses
          // interior positions to [0, docEnd]. Re-RESOLVE the Yjs anchors
          // instead; they survive any remote edit by construction.
          const isYjsSync = Boolean(tr.getMeta(ySyncPluginKey))
          const st = isYjsSync && value.relFrom && value.relTo ? ystate(newState) : null
          let resolved: InlineAiPreviewState | null = null
          if (st && value.relFrom && value.relTo) {
            const from = relativePositionToAbsolutePosition(
              st.doc,
              st.type,
              value.relFrom,
              st.binding.mapping,
            )
            const to = relativePositionToAbsolutePosition(
              st.doc,
              st.type,
              value.relTo,
              st.binding.mapping,
            )
            if (from != null && to != null && from <= to) {
              resolved = { ...value, from, to }
            }
          }
          // Local edits (and anchor-less/orphaned states) take the mapping path.
          next = resolved ?? mapRangeThrough(value, tr)
        }
        // 2. Fold in any meta-action. A new range ('capture'/'start') is
        //    re-anchored in the Yjs doc immediately.
        const meta = tr.getMeta(inlineAiPluginKey) as InlineAiMeta | undefined
        if (meta) {
          next = applyMeta(next, meta)
          if (meta.type === 'capture' || meta.type === 'start') {
            next = withYjsAnchors(next, newState)
          }
        }
        return next
      },
    },
    props: {
      decorations(this: Plugin<InlineAiPreviewState>, state: EditorState): DecorationSet {
        const preview = inlineAiPluginKey.getState(state)
        if (!preview) return DecorationSet.empty
        return buildDecorations(state, preview, opts.renderPreview, opts.editor)
      },
    },
  })

/** Renderer-less plugin singleton for the pure decoration/state tests. */
export const inlineAiPlugin: Plugin<InlineAiPreviewState> = createInlineAiPlugin({
  renderPreview: null,
  editor: null,
})

// --- accept (the single-transaction mutation) -------------------------------

/**
 * How the accepted preview lands in the doc.
 *   - 'replace' (default): the existing per-action behavior (replace/expand).
 *   - 'insertBelow': keep the original selection untouched and add the result
 *     as a NEW top-level paragraph after the selection's block (Notion's
 *     «Вставить ниже»).
 */
export type InlineAiApplyMode = 'replace' | 'insertBelow'

/** Where the accepted preview lands: replace a range, or insert at a position. */
export type InlineAiAcceptTarget =
  { kind: 'replaceRange'; from: number; to: number } | { kind: 'insertAt'; pos: number }

/**
 * Resolve WHERE the accepted preview lands (pure over state — the drift-guarded
 * range math, testable without a DOM). Positions are clamped to the doc so a
 * stale range can never throw out of applyInlineAiResult. Returns `null` when
 * no preview is active.
 *
 *   - mode 'insertBelow': after the selection's top-level block (Notion's
 *     «Вставить ниже», spec §5) — the original content is untouched.
 *   - mode 'replace' (default):
 *     - replace actions (summarize/rewrite/grammar/translate/shorten/custom):
 *       the CURRENT mapped [from,to];
 *     - expand: insert at `to`, leaving the original selection intact.
 */
export const resolveInlineAiAcceptTarget = (
  state: EditorState,
  mode: InlineAiApplyMode = 'replace',
): InlineAiAcceptTarget | null => {
  const preview = inlineAiPluginKey.getState(state)
  if (!preview?.active) return null
  const docSize = state.doc.content.size
  const from = Math.max(0, Math.min(preview.from, docSize))
  const to = Math.max(from, Math.min(preview.to, docSize))
  if (mode === 'insertBelow') {
    const $to = state.doc.resolve(to)
    return { kind: 'insertAt', pos: $to.depth >= 1 ? $to.after(1) : docSize }
  }
  if (preview.action === 'expand') {
    // Append after the selection; original content untouched.
    return { kind: 'insertAt', pos: to }
  }
  // Replace the selection with the transformed content.
  return { kind: 'replaceRange', from, to }
}

/**
 * Accept the active preview against a live editor in ONE transaction (the popover
 * «Принять» / «Вставить ниже» handlers): a single chain = a single doc mutation =
 * a single Yjs op = one collaborative-undo step (spec §4.2 / §7 invariant 5).
 * The answer is parsed as MARKDOWN (markdownToHtml → insertContentAt — the
 * SpaceAiBar accept precedent): models answer in markdown (`**жирный**`, lists,
 * fenced code), and the generate prompt explicitly demands it — inserting the
 * raw string as one text node left literal `**` in the doc. The same chain
 * carries the `clear` meta so the preview is dismissed atomically with the
 * edit. No-op when no preview is active or the editor is destroyed. Returns
 * true when the accept was dispatched.
 */
export const applyInlineAiResult = (
  editor: Editor,
  mode: InlineAiApplyMode = 'replace',
): boolean => {
  if (editor.isDestroyed) return false
  const preview = getInlineAiPreview(editor)
  if (!preview.active) return false
  const target = resolveInlineAiAcceptTarget(editor.state, mode)
  if (!target) return false
  const chain = editor.chain().focus()
  if (!preview.text) {
    // Nothing streamed (unreachable from the UI — accept is disabled without
    // text): replacing with nothing = deleting the range; inserting nothing is
    // a no-op. Keep the old semantics.
    if (target.kind === 'replaceRange' && target.to > target.from) {
      chain.deleteRange({ from: target.from, to: target.to })
    }
  } else {
    const html = markdownToHtml(preview.text)
    if (target.kind === 'replaceRange') {
      chain.insertContentAt({ from: target.from, to: target.to }, html)
    } else {
      chain.insertContentAt(target.pos, html)
    }
  }
  return chain
    .command(({ tr }) => {
      // Dismiss the preview atomically (same transaction).
      tr.setMeta(inlineAiPluginKey, inlineAiClearMeta())
      return true
    })
    .scrollIntoView()
    .run()
}

// --- command helpers (dispatch the metas from the popover / apps/web) --------

/** Hold the captured selection while the ask-AI popover is open: the range is
 *  highlighted (the popover's autofocused input steals the native selection
 *  paint) and drift-tracked, so a doc edit in the popover-open gap can't aim
 *  the eventual preview at the wrong range. */
export const captureInlineAiRange = (editor: Editor, args: { from: number; to: number }): void => {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(inlineAiPluginKey, inlineAiCaptureMeta(args)))
}

/** Start a preview over [from,to] for `action` (the popover action-pick). */
export const startInlineAiPreview = (
  editor: Editor,
  args: { from: number; to: number; action: string },
): void => {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(inlineAiPluginKey, inlineAiStartMeta(args)))
}

/** Append a streamed token to the active preview. Guards a destroyed view. */
export const appendInlineAiToken = (editor: Editor, token: string): void => {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta(token)))
}

/** Mark the active preview's stream complete. */
export const finishInlineAiPreview = (editor: Editor): void => {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(inlineAiPluginKey, inlineAiFinishMeta()))
}

/** Mark the active preview failed with a user-facing message. */
export const failInlineAiPreview = (editor: Editor, error: string): void => {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(inlineAiPluginKey, inlineAiFailMeta(error)))
}

/** Discard the active preview (the «Отклонить» handler) — doc untouched. */
export const clearInlineAiPreview = (editor: Editor): void => {
  if (editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(inlineAiPluginKey, inlineAiClearMeta()))
}

/** Read the current preview state off a live editor (the popover renders it). */
export const getInlineAiPreview = (editor: Editor): InlineAiPreviewState =>
  inlineAiPluginKey.getState(editor.state) ?? INACTIVE

// --- the Extension ----------------------------------------------------------

import type { AskAICallback } from '../types'

export type InlineAiOptions = {
  /**
   * apps/web's streaming bridge — turns a preset action + selection into the
   * `/api/ai/inline` SSE stream and exposes onToken/onError/done/abort
   * (AskAIHandle). When null the bubble-menu button is hidden (the capability is
   * absent) — exactly the comments `canComment` gating.
   */
  askAI: AskAICallback | null
  /** Optional app-injected toolbar/preview renderer for the widget decoration. */
  renderPreview: InlineAiRenderPreview | null
}

export type InlineAiStorage = {
  /** Mirrored onto editor.storage.ai so the bubble-menu can read/call it. */
  askAI: AskAICallback | null
  /** The app-injected widget renderer (set by configure). */
  render: InlineAiRenderPreview | null
}

export const InlineAI = Extension.create<InlineAiOptions, InlineAiStorage>({
  name: 'inlineAi',

  addOptions() {
    return { askAI: null, renderPreview: null }
  },

  addStorage() {
    return { askAI: null, render: null }
  },

  onCreate() {
    // Expose the capability on editor.storage.ai (the comments-storage
    // precedent) so floating-toolbar can gate the «Спросить AI» button on
    // `editor.storage.ai?.askAI` and the popover can call it.
    //
    // MERGE, don't replace: anynote-editor's effect adds `onAskAi` (which opens
    // the popover) onto the SAME `editor.storage.ai` object. `onCreate` can fire
    // after that effect (Tiptap reinitializes the view on the ydoc/provider deps,
    // and the editor reference stays stable so the effect doesn't re-run). A
    // wholesale `= { askAI }` here clobbers `onAskAi`, so the bubble-menu button
    // renders (it only gates on `askAI`) but its click silently no-ops. Spreading
    // the existing keys preserves whichever side ran first.
    this.storage.askAI = this.options.askAI
    this.storage.render = this.options.renderPreview
    const storage = this.editor.storage as unknown as Record<string, unknown>
    const existingAi = (storage.ai as Record<string, unknown> | undefined) ?? {}
    storage.ai = { ...existingAi, askAI: this.options.askAI }
  },

  addProseMirrorPlugins() {
    return [
      createInlineAiPlugin({
        renderPreview: this.options.renderPreview,
        editor: this.editor,
      }),
    ]
  },
})
