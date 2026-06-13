// Collapsible headings — spec §5, §7 invariant 4. A ProseMirror plugin that
// folds a heading's following section LOCALLY (per-viewer), via decorations
// only: the document/Yjs is NEVER touched. Collapsing hides each node in the
// section range with a `display:none` node decoration; the serialized doc is
// byte-identical whether collapsed or not. Collapsed-heading keys persist in
// localStorage keyed by pageId, never in Yjs — another collaborator never sees
// your collapse, and a brand-new viewer sees everything expanded.
//
// KEY-STABILITY NOTE: headings are stock StarterKit nodes with NO stable
// id/anchor attribute (BlockIndexAttributes' `data-block-index` is positional
// and shifts on any insert above; BlockBackground adds no id). So the collapse
// key is derived from (level, normalized text, ordinal-among-identical). The
// documented caveat: editing a heading's text or reordering identical-text
// headings changes its key, which resets that heading's collapse state to
// expanded. This is acceptable for a view aid (it is NOT document structure).

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// --- pure helpers ----------------------------------------------------------

export type Range = { from: number; to: number }

export type HeadingEntry = {
  /** Top-level position where the heading node starts. */
  pos: number
  level: number
  /** The normalized heading text. */
  text: string
  /** 0-based index among headings sharing the same (level, normalized text). */
  ordinal: number
  /** The localStorage/plugin-state key for this heading. */
  key: string
}

const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * Derive the collapse key from a heading's (level, text, ordinal). Stable for
 * the same triple; differs across level, text, or ordinal. See the
 * KEY-STABILITY NOTE above for the caveat.
 */
export const collapseKey = (level: number, text: string, ordinal: number): string =>
  `h${level}:${ordinal}:${normalizeText(text)}`

/**
 * Walk the doc's top-level children and return one entry per heading, with an
 * ordinal that disambiguates identical (level, normalized-text) headings so
 * every key is unique within the doc.
 */
export const deriveHeadingEntries = (doc: PMNode): HeadingEntry[] => {
  const entries: HeadingEntry[] = []
  const seen = new Map<string, number>()
  let pos = 0
  doc.content.forEach((node) => {
    if (node.type.name === 'heading') {
      const level = (node.attrs.level as number) ?? 1
      const text = normalizeText(node.textContent)
      const base = `h${level}:${text}`
      const ordinal = seen.get(base) ?? 0
      seen.set(base, ordinal + 1)
      entries.push({ pos, level, text, ordinal, key: collapseKey(level, text, ordinal) })
    }
    pos += node.nodeSize
  })
  return entries
}

/**
 * The section range owned by the heading at `headingPos`:
 * `[after-the-heading, next-same-or-higher-level-heading-or-doc-end)`. A deeper
 * (higher-numbered level) heading is part of the section; a same-or-higher
 * (lower-or-equal level number) heading ends it. Empty range (from === to) for
 * a trailing heading with no following content.
 */
export const sectionRange = (doc: PMNode, headingPos: number): Range => {
  const $heading = doc.resolve(headingPos)
  const headingNode = doc.nodeAt(headingPos)
  const level = (headingNode?.attrs.level as number) ?? 1
  const from = headingPos + (headingNode?.nodeSize ?? 0)

  let to = doc.content.size
  let pos = from
  // Walk the top-level siblings after the heading until a same-or-higher heading.
  const startIndex = $heading.index() + 1
  for (let i = startIndex; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (child.type.name === 'heading' && ((child.attrs.level as number) ?? 1) <= level) {
      to = pos
      break
    }
    pos += child.nodeSize
  }
  return { from, to }
}

/**
 * The list of per-node ranges to hide for the given set of collapsed keys —
 * one range per top-level node inside each collapsed section (so each node gets
 * its own `display:none` decoration). Pure: it reads the doc, never mutates it.
 */
export const hiddenNodeRanges = (doc: PMNode, collapsedKeys: ReadonlySet<string>): Range[] => {
  if (collapsedKeys.size === 0) return []
  const ranges: Range[] = []
  for (const entry of deriveHeadingEntries(doc)) {
    if (!collapsedKeys.has(entry.key)) continue
    const { from, to } = sectionRange(doc, entry.pos)
    if (from >= to) continue
    // Emit one range per top-level node in [from, to).
    let pos = from
    const $from = doc.resolve(from)
    for (let i = $from.index(); i < doc.childCount; i++) {
      const child = doc.child(i)
      const childStart = pos
      const childEnd = pos + child.nodeSize
      if (childStart >= to) break
      ranges.push({ from: childStart, to: childEnd })
      pos = childEnd
    }
  }
  return ranges
}

// --- localStorage round-trip ------------------------------------------------
//
// CAVEAT (documented, by design — matches the embed-prefs precedent in
// embed-prefs.ts): these per-page keys are NOT pruned when a page is deleted, so
// a deleted page leaves a small orphan entry behind. This is bounded (one tiny
// array per page the viewer ever collapsed, on that browser only) and never
// affects another viewer or the document, so wiring page-delete cleanup is out
// of scope here. An empty collapsed set already removes its own key (see
// writeCollapsed), so the only residue is from pages deleted while collapsed.

const PREFIX = 'anynote:collapsed:'

export const collapsedPrefKey = (pageId: string): string => `${PREFIX}${pageId}`

/** The set of collapsed heading keys for this page (empty when none / on error). */
export const readCollapsed = (pageId: string): Set<string> => {
  try {
    if (typeof localStorage === 'undefined') return new Set()
    const raw = localStorage.getItem(collapsedPrefKey(pageId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

/** Persist the collapsed set; an empty set removes the key (no orphan arrays). */
export const writeCollapsed = (pageId: string, keys: ReadonlySet<string>): void => {
  try {
    if (typeof localStorage === 'undefined') return
    if (keys.size === 0) {
      localStorage.removeItem(collapsedPrefKey(pageId))
      return
    }
    localStorage.setItem(collapsedPrefKey(pageId), JSON.stringify([...keys]))
  } catch {
    // Privacy mode / storage disabled — keep the in-session state only.
  }
}

// --- the ProseMirror plugin -------------------------------------------------

export type CollapsibleHeadingsOptions = {
  /** The current pageId — the localStorage key for the collapsed set. */
  pageId: string | null
}

type CollapseToggleMeta = { type: 'toggle'; key: string }

type CollapseState = { collapsed: Set<string> }

export const collapsibleHeadingsKey = new PluginKey<CollapseState>('collapsibleHeadings')

const TOGGLE_CLASS = 'anynote-collapse-toggle'

// Stable empty-set fallback so the decoration memo can still hit when the plugin
// state is somehow absent (a fresh Set() each call would defeat the identity check).
const EMPTY_COLLAPSED: ReadonlySet<string> = new Set<string>()

/**
 * Build the ▸/▾ toggle widget that sits before a heading. A real
 * `<button aria-expanded>` so it is keyboard-operable. Like the column-resize
 * divider, the widget carries its target in a `data-*` attribute and the click
 * is handled in `handleDOMEvents` (which receives the live view) — so the
 * decoration builder stays a pure `(doc, collapsed)` function, no view closure.
 */
const buildToggleWidget = (key: string, isCollapsed: boolean): HTMLButtonElement => {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = TOGGLE_CLASS
  btn.dataset.collapseKey = key
  btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true')
  btn.setAttribute('aria-label', isCollapsed ? 'Развернуть раздел' : 'Свернуть раздел')
  btn.contentEditable = 'false'
  btn.textContent = isCollapsed ? '▸' : '▾'
  return btn
}

/** Build the full decoration set for a doc + collapsed-key set (pure). */
const buildDecorations = (doc: PMNode, collapsed: ReadonlySet<string>): DecorationSet => {
  const decos: Decoration[] = []

  for (const entry of deriveHeadingEntries(doc)) {
    const isCollapsed = collapsed.has(entry.key)
    // `side: -1` places the toggle just inside the heading, before its text.
    decos.push(
      Decoration.widget(entry.pos + 1, () => buildToggleWidget(entry.key, isCollapsed), {
        side: -1,
        key: `collapse-toggle:${entry.key}:${isCollapsed ? 'c' : 'e'}`,
        ignoreSelection: true,
      }),
    )
  }

  // Each node in a collapsed section gets its own `display:none` node
  // decoration — content stays in the doc, only the rendering is hidden.
  for (const { from, to } of hiddenNodeRanges(doc, collapsed)) {
    decos.push(
      Decoration.node(from, to, {
        class: 'anynote-collapsed-section',
        style: 'display:none',
        'aria-hidden': 'true',
      }),
    )
  }

  return DecorationSet.create(doc, decos)
}

/**
 * The collapsible-headings extension. Threaded `pageId` (from buildExtensions →
 * page-renderer) keys the localStorage round-trip. No schema change — headings
 * stay stock StarterKit; collapse is a per-viewer view aid via decorations.
 */
export const CollapsibleHeadings = Extension.create<CollapsibleHeadingsOptions>({
  name: 'collapsibleHeadings',

  addOptions() {
    return { pageId: null }
  },

  addProseMirrorPlugins() {
    const pageId = this.options.pageId

    // Single-slot decoration memo, scoped to THIS plugin instance (one per
    // editor — never shared across editors). `decorations()` runs on every
    // transaction, including pure no-ops (caret moves, selection-only changes,
    // remote presence). Rebuilding the whole DecorationSet each time is wasted
    // work on a large doc, so we cache the last result keyed by (doc, collapsed)
    // identity: `state.doc` only changes identity on a doc edit, and the
    // `collapsed` Set is replaced only on a toggle (the apply() below returns the
    // same value object otherwise), so an identity match means nothing relevant
    // changed and the cached set is still valid.
    let memoDoc: PMNode | null = null
    let memoCollapsed: ReadonlySet<string> | null = null
    let memoDecos: DecorationSet = DecorationSet.empty

    return [
      new Plugin<CollapseState>({
        key: collapsibleHeadingsKey,
        state: {
          init: () => ({ collapsed: pageId ? readCollapsed(pageId) : new Set() }),
          apply(tr, value) {
            const meta = tr.getMeta(collapsibleHeadingsKey) as CollapseToggleMeta | undefined
            if (meta?.type === 'toggle') {
              const next = new Set(value.collapsed)
              if (next.has(meta.key)) next.delete(meta.key)
              else next.add(meta.key)
              if (pageId) writeCollapsed(pageId, next)
              return { collapsed: next }
            }
            // Doc edits don't touch the Set: it is keyed by content, not
            // position, so it survives edits without mapping. (A stale key
            // simply matches no heading — hiddenNodeRanges drops it.)
            return value
          },
        },
        props: {
          decorations(state: EditorState): DecorationSet {
            const collapsed =
              collapsibleHeadingsKey.getState(state)?.collapsed ?? EMPTY_COLLAPSED
            // Cache hit: neither the doc nor the collapsed set changed identity —
            // the previously-built decorations are still exactly correct.
            if (memoDoc === state.doc && memoCollapsed === collapsed) return memoDecos
            memoDecos = buildDecorations(state.doc, collapsed)
            memoDoc = state.doc
            memoCollapsed = collapsed
            return memoDecos
          },
          handleDOMEvents: {
            // The toggle is a real button; we own the mousedown so the caret
            // never lands inside the heading, and the click so it folds.
            mousedown(_view: EditorView, event: MouseEvent): boolean {
              const target = event.target
              if (target instanceof HTMLElement && target.classList.contains(TOGGLE_CLASS)) {
                event.preventDefault()
                return true
              }
              return false
            },
            click(view: EditorView, event: MouseEvent): boolean {
              const target = event.target
              if (!(target instanceof HTMLElement) || !target.classList.contains(TOGGLE_CLASS)) {
                return false
              }
              const key = target.dataset.collapseKey
              if (!key) return false
              event.preventDefault()
              view.dispatch(
                view.state.tr.setMeta(collapsibleHeadingsKey, { type: 'toggle', key }),
              )
              return true
            },
          },
        },
      }),
    ]
  },
})
