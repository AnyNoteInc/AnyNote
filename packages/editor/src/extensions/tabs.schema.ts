import { Node } from '@tiptap/core'
import type { Node as PMNode, NodeSpec } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

// Raw NodeSpecs — exported so unit tests can build a prosemirror-model Schema
// directly without spinning up a Tiptap Editor (the column-layout precedent).
//
// `tabs` is the parent container (content: 'tab+', defining) carrying the
// per-render `activeTab` index. Each `tab` child is an isolating `block+`
// section with a `label`. The active tab's content is shown in the NodeView;
// the inactive tabs are hidden in THIS render but remain real shared doc
// content (they round-trip through serialize/export — spec §8.5).
export const DEFAULT_TAB_LABEL = 'Вкладка'

export const tabsSpec: NodeSpec = {
  group: 'block',
  content: 'tab+',
  attrs: {
    activeTab: { default: 0 },
  },
  defining: true,
  isolating: false,
  parseDOM: [
    {
      tag: 'div[data-type="tabs"]',
      getAttrs: (dom) => ({
        activeTab: dom instanceof HTMLElement ? Number(dom.dataset.activeTab) || 0 : 0,
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'tabs',
      'data-active-tab': String(node.attrs.activeTab ?? 0),
      class: 'tabs',
    },
    0,
  ],
}

export const tabSpec: NodeSpec = {
  content: 'block+',
  isolating: true,
  attrs: {
    label: { default: DEFAULT_TAB_LABEL },
  },
  parseDOM: [
    {
      tag: 'div[data-type="tab"]',
      getAttrs: (dom) => {
        const el = dom as { getAttribute?: (key: string) => string | null }
        return {
          label: el.getAttribute?.('data-label') || DEFAULT_TAB_LABEL,
        }
      },
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'tab',
      'data-label': String(node.attrs.label ?? DEFAULT_TAB_LABEL),
      class: 'tab',
    },
    0,
  ],
}

// Tiptap Nodes that mirror the specs above. These are the "schema-only"
// extensions consumed by server-side rendering (no NodeView, no plugins).
// The client extension in `tabs.tsx` extends these with the tab-strip NodeView
// + the appendTransaction clamp/dissolve plugin.
//
// Registering them server-side is load-bearing: `generateHTML` (export/preview)
// walks the doc with the server extension set, and an unregistered custom node
// makes it throw (the columnLayout production crash precedent — see
// embedded-database.schema.ts header).
//
// Server export is NON-interactive (PDF/HTML can't show a tab strip), so
// `renderHTML` of the parent stacks every tab; the child renders a
// `<strong>{label}</strong>` header then its content (spec §2).
export const TabsSchema = Node.create({
  name: 'tabs',
  group: 'block',
  content: 'tab+',
  defining: true,
  addAttributes() {
    return {
      activeTab: {
        default: 0,
        parseHTML: (element) =>
          element instanceof HTMLElement ? Number(element.dataset.activeTab) || 0 : 0,
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="tabs"]' }]
  },
  renderHTML() {
    return [
      'div',
      {
        'data-type': 'tabs',
        class: 'tabs',
      },
      0,
    ]
  },
})

export const TabSchema = Node.create({
  name: 'tab',
  content: 'block+',
  isolating: true,
  addAttributes() {
    return {
      label: {
        default: DEFAULT_TAB_LABEL,
        parseHTML: (element) =>
          element instanceof HTMLElement
            ? element.dataset.label || DEFAULT_TAB_LABEL
            : DEFAULT_TAB_LABEL,
        renderHTML: (attrs) => ({
          'data-label': String(attrs.label ?? DEFAULT_TAB_LABEL),
        }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="tab"]' }]
  },
  // Server/export render: a labeled section. The parent stacks all tabs, so
  // every tab shows its `<strong>{label}</strong>` header then its content.
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'tab',
        'data-label': String(node.attrs.label ?? DEFAULT_TAB_LABEL),
        class: 'tab',
      },
      ['strong', { class: 'tab__label' }, String(node.attrs.label ?? DEFAULT_TAB_LABEL)],
      ['div', { class: 'tab__content' }, 0],
    ]
  },
})

// ---------------------------------------------------------------------------
// Pure helpers (no React, no Tiptap Editor) — tested in tabs.test.ts and used
// by the tabs.tsx appendTransaction plugin / NodeView.
// ---------------------------------------------------------------------------

/**
 * Clamp a desired `activeTab` index into the valid `[0, tabCount - 1]` range.
 * A block with 0 tabs has no valid active index → returns 0 (the dissolve rule
 * removes such a block, so the value is moot, but we keep it total).
 */
export function clampActiveTab(activeTab: number, tabCount: number): number {
  if (tabCount <= 0) return 0
  if (!Number.isFinite(activeTab)) return 0
  const rounded = Math.trunc(activeTab)
  if (rounded < 0) return 0
  if (rounded > tabCount - 1) return tabCount - 1
  return rounded
}

/**
 * Walk every `tabs` block and, in a single transaction:
 *  - remove a 0-tab block (the column-layout dissolve precedent), AND
 *  - clamp an out-of-range `activeTab` attr to `[0, childCount - 1]`.
 *
 * Returns whether the transaction was mutated (the caller turns a mutated tr
 * into the appendTransaction result). Right-to-left walk keeps position math
 * valid across splices.
 */
export function reconcileTabsInTransaction(tr: Transaction): boolean {
  const { doc } = tr
  let mutated = false
  const blocks: { node: PMNode; pos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'tabs') {
      blocks.push({ node, pos })
      return false
    }
    return true
  })
  for (let i = blocks.length - 1; i >= 0; i--) {
    const entry = blocks[i]
    if (!entry) continue
    const { node: tabs, pos } = entry
    const count = tabs.childCount

    if (count === 0) {
      tr.delete(pos, pos + tabs.nodeSize)
      mutated = true
      continue
    }

    const clamped = clampActiveTab(Number(tabs.attrs.activeTab ?? 0), count)
    if (clamped !== tabs.attrs.activeTab) {
      tr.setNodeMarkup(pos, undefined, { ...tabs.attrs, activeTab: clamped })
      mutated = true
    }
  }
  return mutated
}

/**
 * EditorState → a reconcile Transaction (or null when nothing changed).
 * The appendTransaction plugin in tabs.tsx wraps this.
 */
export function reconcileTabs(state: EditorState): Transaction | null {
  const tr = state.tr
  const mutated = reconcileTabsInTransaction(tr)
  return mutated ? tr : null
}

/**
 * The starter content a fresh `/tabs` insert produces: a tabs block with two
 * labeled tabs, each holding an empty paragraph. Shared by the slash item and
 * tests so the shape can't drift.
 */
export function createTabsContent(labels: [string, string] = ['Вкладка 1', 'Вкладка 2']) {
  return {
    type: 'tabs',
    attrs: { activeTab: 0 },
    content: labels.map((label) => ({
      type: 'tab',
      attrs: { label },
      content: [{ type: 'paragraph' }],
    })),
  }
}

/**
 * Build a `tabs` Transaction that appends a new empty tab to the block at
 * `tabsPos` and activates it. Returns the mutated tr. The new tab holds a
 * single empty paragraph (the `block+` minimum). The reconcile plugin will
 * re-clamp `activeTab`, but we set it eagerly so the NodeView updates without
 * an extra round-trip.
 */
export function appendTabTransaction(
  tr: Transaction,
  tabsPos: number,
  label?: string,
): Transaction {
  const tabs = tr.doc.nodeAt(tabsPos)
  if (!tabs || tabs.type.name !== 'tabs') return tr
  const schema = tabs.type.schema
  const tabType = schema.nodes.tab
  const paragraphType = schema.nodes.paragraph
  if (!tabType || !paragraphType) return tr
  const newLabel = label ?? `${DEFAULT_TAB_LABEL} ${tabs.childCount + 1}`
  const newTab = tabType.create({ label: newLabel }, paragraphType.create())
  // Insert right after the block's last child (just before the closing token).
  const insertAt = tabsPos + tabs.nodeSize - 1
  tr.insert(insertAt, newTab)
  // Activate the new tab (index === old childCount).
  const refreshed = tr.doc.nodeAt(tabsPos)
  if (refreshed) {
    tr.setNodeMarkup(tabsPos, undefined, { ...refreshed.attrs, activeTab: tabs.childCount })
  }
  return tr
}

/**
 * Build a `tabs` Transaction that removes the tab at child-index `tabIndex`
 * from the block at `tabsPos`. If that was the last remaining tab, the whole
 * block is removed (the dissolve rule; the reconcile plugin would also catch a
 * 0-tab block, but we do it here so a single transaction is enough).
 * `activeTab` is re-clamped to the surviving range.
 */
export function removeTabTransaction(
  tr: Transaction,
  tabsPos: number,
  tabIndex: number,
): Transaction {
  const tabs = tr.doc.nodeAt(tabsPos)
  if (!tabs || tabs.type.name !== 'tabs') return tr
  if (tabIndex < 0 || tabIndex >= tabs.childCount) return tr

  // Last tab → remove the entire block (dissolve).
  if (tabs.childCount === 1) {
    tr.delete(tabsPos, tabsPos + tabs.nodeSize)
    return tr
  }

  // Compute the child's start offset inside the block.
  let childStart = tabsPos + 1
  for (let i = 0; i < tabIndex; i++) {
    childStart += tabs.child(i).nodeSize
  }
  const child = tabs.child(tabIndex)
  tr.delete(childStart, childStart + child.nodeSize)

  // Re-clamp activeTab against the new count.
  const refreshed = tr.doc.nodeAt(tabsPos)
  if (refreshed) {
    const clamped = clampActiveTab(Number(refreshed.attrs.activeTab ?? 0), refreshed.childCount)
    if (clamped !== refreshed.attrs.activeTab) {
      tr.setNodeMarkup(tabsPos, undefined, { ...refreshed.attrs, activeTab: clamped })
    }
  }
  return tr
}
