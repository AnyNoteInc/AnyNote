# Column Layout: Unlimited Columns + Resizable Dividers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-column cap on column layouts with arbitrary column counts, add a draggable divider in each gap that redistributes width between neighbors, and hide drag-handle controls for `columnLayout`/`column` nodes themselves.

**Architecture:** Schema gains a `width` attr on `column` (default `1`, unitless flex share). Layout switches from CSS Grid to flexbox with `flex: var(--column-width, 1) 1 0` per column. A new ProseMirror plugin (`column-resize.ts`) emits `Decoration.widget` divider elements between cells; mousedown on a divider drags it via live transactions marked `addToHistory: false`, finalized on `mouseup` with one historied transaction. The drag-handle library is told to never target `columnLayout` or `column` via a `DragHandleRule`.

**Tech Stack:** TipTap 3.22 / ProseMirror, vitest (unit), Playwright (e2e), TypeScript, CSS.

**Spec:** [docs/superpowers/specs/2026-05-13-column-layout-resize-and-unlimited-design.md](../specs/2026-05-13-column-layout-resize-and-unlimited-design.md)

---

## File map

**Create:**
- `packages/editor/src/extensions/column-resize.ts` — resize plugin + pure helper
- `packages/editor/src/extensions/column-resize.test.ts` — unit tests for the helper

**Modify:**
- `packages/editor/src/extensions/column-layout.schema.ts` — `column{1,3}` → `column+`, add `width` attr to column
- `packages/editor/src/extensions/column-layout.schema.test.ts` — update assertions
- `packages/editor/src/extensions/column-layout.ts` — register `columnResizePlugin`
- `packages/editor/src/extensions/column-layout.dissolve.test.ts` — add 4-cell regression
- `packages/editor/src/extensions/drop-placement.ts` — remove `MAX_COLUMNS` cap
- `packages/editor/src/components/drag-handle.tsx` — add `excludeColumnNodes` rule, strip cell context
- `packages/editor/src/components/drag-handle-menu.tsx` — remove cell/row dead code
- `packages/editor/src/styles/content.css` — grid → flex, divider styles
- `packages/editor/src/styles/content.test.ts` — flex assertions, divider assertions
- `apps/e2e/page-columns.spec.ts` — new tests, rename existing

---

## Task 1: Schema — add `width` attr to column + drop 3-cell cap

**Files:**
- Modify: `packages/editor/src/extensions/column-layout.schema.ts`
- Test: `packages/editor/src/extensions/column-layout.schema.test.ts`

- [ ] **Step 1: Update schema tests for new behavior**

Open `packages/editor/src/extensions/column-layout.schema.test.ts`. Replace the existing `'accepts a layout with 3 columns'` and `'rejects a layout with 4 columns'` cases with these tests:

```ts
  it('accepts a layout with 3 columns', () => {
    const doc = schema.nodes.doc.create(null, [
      layout(column(paragraph()), column(paragraph()), column(paragraph())),
    ])
    expect(() => doc.check()).not.toThrow()
  })

  it('accepts a layout with 4 columns (no upper cap)', () => {
    const doc = schema.nodes.doc.create(null, [
      layout(
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
      ),
    ])
    expect(() => doc.check()).not.toThrow()
  })

  it('accepts a layout with 6 columns (no upper cap)', () => {
    const doc = schema.nodes.doc.create(null, [
      layout(
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
      ),
    ])
    expect(() => doc.check()).not.toThrow()
  })
```

Then below `'rejects a column at the top level (must be inside layout)'`, append:

```ts
  it('defaults column width to 1', () => {
    const node = column(paragraph())
    expect(node.attrs.width).toBe(1)
  })

  it('renders column with data-width and --column-width inline style', () => {
    const node = schema.nodes.column.create({ width: 1.5 }, [paragraph()])
    const dom = columnSpec.toDOM!(node) as [string, Record<string, string>, number]
    expect(dom[1]['data-width']).toBe('1.5')
    expect(dom[1].style).toContain('--column-width: 1.5')
  })

  it('parses width from data-width attribute', () => {
    // parseDOM rule shape: getAttrs reads element.getAttribute('data-width')
    const rule = columnSpec.parseDOM![0]!
    const fakeEl = { getAttribute: (key: string) => (key === 'data-width' ? '2.5' : null) }
    const attrs = (rule.getAttrs as (el: unknown) => Record<string, unknown>)(fakeEl)
    expect(attrs.width).toBe(2.5)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @repo/editor test column-layout.schema
```

Expected: 4 new tests fail (the new ones reference attrs/getAttrs that don't exist yet); the `'rejects a layout with 4 columns'` test was removed so it can't fail anymore.

- [ ] **Step 3: Update the schema**

Replace the contents of `packages/editor/src/extensions/column-layout.schema.ts` with:

```ts
import { Node } from '@tiptap/core'
import type { NodeSpec } from '@tiptap/pm/model'

// Raw NodeSpecs — exported so unit tests can build a prosemirror-model Schema
// directly without spinning up a Tiptap Editor.
export const columnLayoutSpec: NodeSpec = {
  group: 'block',
  content: 'column+',
  attrs: {
    columns: { default: null },
  },
  defining: true,
  isolating: false,
  parseDOM: [
    {
      tag: 'div[data-type="column-layout"]',
      getAttrs: (dom) => ({
        columns:
          dom instanceof HTMLElement ? Number(dom.getAttribute('data-columns')) || null : null,
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'column-layout',
      'data-columns': String(node.attrs.columns ?? node.childCount),
      class: 'column-layout',
    },
    0,
  ],
}

export const columnSpec: NodeSpec = {
  content: 'block+',
  isolating: true,
  attrs: {
    width: { default: 1 },
  },
  parseDOM: [
    {
      tag: 'div[data-type="column"]',
      getAttrs: (dom) => ({
        width:
          dom instanceof HTMLElement ? Number(dom.getAttribute('data-width')) || 1 : 1,
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'column',
      'data-width': String(node.attrs.width),
      class: 'column',
      style: `--column-width: ${node.attrs.width}`,
    },
    0,
  ],
}

// Tiptap Nodes that mirror the specs above. These are the "schema-only"
// extensions consumed by server-side rendering (no NodeView, no plugins).
// The client extension in `column-layout.ts` extends these with the
// appendTransaction dissolve plugin.
export const ColumnLayoutSchema = Node.create({
  name: 'columnLayout',
  group: 'block',
  content: 'column+',
  addAttributes() {
    return {
      columns: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-columns')) || null,
        renderHTML: () => ({}),
      },
    }
  },
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column-layout"]' }]
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'column-layout',
        'data-columns': String(node.attrs.columns ?? node.childCount),
        class: 'column-layout',
      },
      0,
    ]
  },
})

export const ColumnSchema = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  addAttributes() {
    return {
      width: {
        default: 1,
        parseHTML: (element) => Number(element.getAttribute('data-width')) || 1,
        renderHTML: (attrs) => ({
          'data-width': String(attrs.width ?? 1),
          style: `--column-width: ${attrs.width ?? 1}`,
        }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'column',
        'data-width': String(node.attrs.width),
        class: 'column',
        style: `--column-width: ${node.attrs.width}`,
      },
      0,
    ]
  },
})
```

Notes on the diff:
- `column{1,3}` → `column+` on both `columnLayoutSpec` and `ColumnLayoutSchema`.
- Drop the `column-layout--N` class modifier (CSS no longer keys off it).
- `columnSpec` and `ColumnSchema` gain a `width` attribute with default `1`. `parseDOM`/`parseHTML` reads `data-width`; `toDOM`/`renderHTML` emits `data-width` and inline `style="--column-width: ..."`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @repo/editor test column-layout.schema
```

Expected: all tests in `column-layout.schema.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/column-layout.schema.ts \
        packages/editor/src/extensions/column-layout.schema.test.ts
git commit -m "feat(editor): allow unlimited columns; add per-column width attr

- columnLayout content: column{1,3} → column+
- column gains width attr (default 1, unitless flex share)
- column renderHTML emits data-width + inline --column-width style"
```

---

## Task 2: Pure helper — `computeResizedWidths`

**Files:**
- Create: `packages/editor/src/extensions/column-resize.ts`
- Test: `packages/editor/src/extensions/column-resize.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/editor/src/extensions/column-resize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { computeResizedWidths, MIN_WIDTH_FRACTION } from './column-resize'

describe('computeResizedWidths', () => {
  it('returns inputs unchanged when delta is 0', () => {
    const result = computeResizedWidths(1, 1, 0, MIN_WIDTH_FRACTION)
    expect(result).toEqual({ left: 1, right: 1 })
  })

  it('moves share from right to left for positive delta', () => {
    const result = computeResizedWidths(1, 1, 0.3, MIN_WIDTH_FRACTION)
    expect(result.left).toBeCloseTo(1.3, 5)
    expect(result.right).toBeCloseTo(0.7, 5)
    expect(result.left + result.right).toBeCloseTo(2, 5)
  })

  it('moves share from left to right for negative delta', () => {
    const result = computeResizedWidths(1, 1, -0.4, MIN_WIDTH_FRACTION)
    expect(result.left).toBeCloseTo(0.6, 5)
    expect(result.right).toBeCloseTo(1.4, 5)
    expect(result.left + result.right).toBeCloseTo(2, 5)
  })

  it('keeps the sum identical to left + right', () => {
    const result = computeResizedWidths(2, 1, 0.5, MIN_WIDTH_FRACTION)
    expect(result.left + result.right).toBeCloseTo(3, 5)
  })

  it('clamps left when delta would push it below sum * MIN_WIDTH_FRACTION', () => {
    // sum = 2, min = 0.2 (10%), so left can go no lower than 0.2.
    const result = computeResizedWidths(1, 1, -2, 0.1)
    expect(result.left).toBeCloseTo(0.2, 5)
    expect(result.right).toBeCloseTo(1.8, 5)
  })

  it('clamps right when delta would push it below sum * MIN_WIDTH_FRACTION', () => {
    const result = computeResizedWidths(1, 1, 2, 0.1)
    expect(result.left).toBeCloseTo(1.8, 5)
    expect(result.right).toBeCloseTo(0.2, 5)
  })

  it('works with non-equal starting widths', () => {
    const result = computeResizedWidths(2, 1, 0.1, MIN_WIDTH_FRACTION)
    expect(result.left).toBeCloseTo(2.1, 5)
    expect(result.right).toBeCloseTo(0.9, 5)
  })

  it('exposes MIN_WIDTH_FRACTION = 0.1', () => {
    expect(MIN_WIDTH_FRACTION).toBe(0.1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @repo/editor test column-resize
```

Expected: all tests fail with "Cannot find module './column-resize'".

- [ ] **Step 3: Implement the helper**

Create `packages/editor/src/extensions/column-resize.ts`:

```ts
// Smallest share a column on either side of a divider may shrink to,
// expressed as a fraction of the pair's combined width. With sum=2 and
// MIN_WIDTH_FRACTION=0.1, each neighbor stays >= 0.2 share.
export const MIN_WIDTH_FRACTION = 0.1

export function computeResizedWidths(
  left: number,
  right: number,
  deltaFraction: number,
  minFraction: number,
): { left: number; right: number } {
  const sum = left + right
  const min = sum * minFraction
  const max = sum - min
  const proposedLeft = left + deltaFraction
  const clampedLeft = Math.max(min, Math.min(max, proposedLeft))
  return { left: clampedLeft, right: sum - clampedLeft }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @repo/editor test column-resize
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/column-resize.ts \
        packages/editor/src/extensions/column-resize.test.ts
git commit -m "feat(editor): add computeResizedWidths helper for column dividers

Pure function that redistributes width between two neighbors while
keeping their sum constant. Clamps each side to MIN_WIDTH_FRACTION
(default 10%) of the pair's combined width."
```

---

## Task 3: Column resize plugin

**Files:**
- Modify: `packages/editor/src/extensions/column-resize.ts`

- [ ] **Step 1: Replace `column-resize.ts` to add the plugin alongside the helper**

Replace the contents of `packages/editor/src/extensions/column-resize.ts` with:

```ts
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// Smallest share a column on either side of a divider may shrink to,
// expressed as a fraction of the pair's combined width. With sum=2 and
// MIN_WIDTH_FRACTION=0.1, each neighbor stays >= 0.2 share.
export const MIN_WIDTH_FRACTION = 0.1

export function computeResizedWidths(
  left: number,
  right: number,
  deltaFraction: number,
  minFraction: number,
): { left: number; right: number } {
  const sum = left + right
  const min = sum * minFraction
  const max = sum - min
  const proposedLeft = left + deltaFraction
  const clampedLeft = Math.max(min, Math.min(max, proposedLeft))
  return { left: clampedLeft, right: sum - clampedLeft }
}

export const columnResizeKey = new PluginKey('columnResize')

type ActiveDrag = {
  layoutPos: number
  rightIndex: number
  startX: number
  initialLeft: number
  initialRight: number
  pixelsPerShare: number
  dividerEl: HTMLElement
}

function buildDividers(doc: PMNode): Decoration[] {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'columnLayout') return true
    if (node.childCount < 2) return false
    let cellPos = pos + 1
    for (let i = 0; i < node.childCount; i++) {
      const cell = node.child(i)
      if (i >= 1) {
        decorations.push(
          Decoration.widget(
            cellPos,
            () => {
              const el = document.createElement('div')
              el.className = 'column-divider'
              el.contentEditable = 'false'
              el.dataset.layoutPos = String(pos)
              el.dataset.rightIndex = String(i)
              return el
            },
            { side: -1, key: `column-divider:${pos}:${i}` },
          ),
        )
      }
      cellPos += cell.nodeSize
    }
    return false
  })
  return decorations
}

function cellPositions(layout: PMNode, layoutPos: number): number[] {
  const positions: number[] = []
  let cellPos = layoutPos + 1
  for (let i = 0; i < layout.childCount; i++) {
    positions.push(cellPos)
    cellPos += layout.child(i).nodeSize
  }
  return positions
}

function readWidth(node: PMNode): number {
  const w = Number(node.attrs.width)
  return Number.isFinite(w) && w > 0 ? w : 1
}

function dispatchWidths(
  view: EditorView,
  layoutPos: number,
  rightIndex: number,
  left: number,
  right: number,
  addToHistory: boolean,
) {
  const layout = view.state.doc.nodeAt(layoutPos)
  if (!layout || layout.type.name !== 'columnLayout') return
  const positions = cellPositions(layout, layoutPos)
  const leftPos = positions[rightIndex - 1]
  const rightPos = positions[rightIndex]
  if (leftPos == null || rightPos == null) return
  const leftNode = layout.child(rightIndex - 1)
  const rightNode = layout.child(rightIndex)
  const tr = view.state.tr
    .setNodeMarkup(leftPos, null, { ...leftNode.attrs, width: left })
    .setNodeMarkup(rightPos, null, { ...rightNode.attrs, width: right })
  if (!addToHistory) tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

function beginDrag(view: EditorView, event: MouseEvent, dividerEl: HTMLElement): ActiveDrag | null {
  const layoutPos = Number(dividerEl.dataset.layoutPos)
  const rightIndex = Number(dividerEl.dataset.rightIndex)
  if (!Number.isFinite(layoutPos) || !Number.isFinite(rightIndex) || rightIndex < 1) return null

  const layout = view.state.doc.nodeAt(layoutPos)
  if (!layout || layout.type.name !== 'columnLayout') return null
  if (rightIndex >= layout.childCount) return null

  const positions = cellPositions(layout, layoutPos)
  const leftPos = positions[rightIndex - 1]
  const rightPos = positions[rightIndex]
  if (leftPos == null || rightPos == null) return null

  const leftDom = view.nodeDOM(leftPos) as HTMLElement | null
  const rightDom = view.nodeDOM(rightPos) as HTMLElement | null
  if (!leftDom || !rightDom) return null

  const initialLeft = readWidth(layout.child(rightIndex - 1))
  const initialRight = readWidth(layout.child(rightIndex))
  const leftPx = leftDom.getBoundingClientRect().width
  const rightPx = rightDom.getBoundingClientRect().width
  const shareSum = initialLeft + initialRight
  const pxSum = leftPx + rightPx
  if (shareSum <= 0 || pxSum <= 0) return null
  const pixelsPerShare = pxSum / shareSum

  dividerEl.classList.add('is-dragging')

  return {
    layoutPos,
    rightIndex,
    startX: event.clientX,
    initialLeft,
    initialRight,
    pixelsPerShare,
    dividerEl,
  }
}

export const columnResizePlugin = new Plugin({
  key: columnResizeKey,
  props: {
    decorations(state: EditorState) {
      return DecorationSet.create(state.doc, buildDividers(state.doc))
    },
    handleDOMEvents: {
      mousedown(view, event) {
        const target = event.target
        if (!(target instanceof HTMLElement)) return false
        if (!target.classList.contains('column-divider')) return false
        const drag = beginDrag(view, event, target)
        if (!drag) return false

        const onMove = (moveEvent: MouseEvent) => {
          const deltaPx = moveEvent.clientX - drag.startX
          const deltaFraction = deltaPx / drag.pixelsPerShare
          const { left, right } = computeResizedWidths(
            drag.initialLeft,
            drag.initialRight,
            deltaFraction,
            MIN_WIDTH_FRACTION,
          )
          dispatchWidths(view, drag.layoutPos, drag.rightIndex, left, right, false)
        }
        const onUp = (upEvent: MouseEvent) => {
          const deltaPx = upEvent.clientX - drag.startX
          const deltaFraction = deltaPx / drag.pixelsPerShare
          const { left, right } = computeResizedWidths(
            drag.initialLeft,
            drag.initialRight,
            deltaFraction,
            MIN_WIDTH_FRACTION,
          )
          dispatchWidths(view, drag.layoutPos, drag.rightIndex, left, right, true)
          drag.dividerEl.classList.remove('is-dragging')
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)

        event.preventDefault()
        return true
      },
    },
  },
})
```

- [ ] **Step 2: Run the existing test to verify the file still compiles**

```bash
pnpm --filter @repo/editor test column-resize
```

Expected: 8 existing tests still pass (the new code adds the plugin but doesn't change the helper).

- [ ] **Step 3: Run type-check**

```bash
pnpm --filter @repo/editor check-types || pnpm check-types --filter @repo/editor
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/column-resize.ts
git commit -m "feat(editor): add columnResizePlugin with divider widgets

Plugin emits Decoration.widget elements between cells of every
columnLayout. Mousedown on a divider drags live (history-suppressed
transactions); mouseup commits one historied transaction with final
widths."
```

---

## Task 4: Register the resize plugin on the ColumnLayout extension

**Files:**
- Modify: `packages/editor/src/extensions/column-layout.ts`

- [ ] **Step 1: Replace the contents of `column-layout.ts`**

```ts
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { ColumnLayoutSchema } from './column-layout.schema'
import { dissolveColumnLayouts } from './column-layout.dissolve'
import { columnResizePlugin } from './column-resize'

export { ColumnSchema as Column } from './column-layout.schema'

const dissolveKey = new PluginKey('columnLayoutDissolve')

export const ColumnLayout = ColumnLayoutSchema.extend({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dissolveKey,
        appendTransaction(_transactions, _oldState, newState) {
          return dissolveColumnLayouts(newState) ?? undefined
        },
      }),
      columnResizePlugin,
    ]
  },
})
```

- [ ] **Step 2: Run editor tests to verify nothing regresses**

```bash
pnpm --filter @repo/editor test
```

Expected: all existing tests pass; no new failures (Playwright e2e is separate).

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/column-layout.ts
git commit -m "feat(editor): register columnResizePlugin on ColumnLayout extension"
```

---

## Task 5: CSS — flex layout + divider styles

**Files:**
- Modify: `packages/editor/src/styles/content.css`
- Test: `packages/editor/src/styles/content.test.ts`

- [ ] **Step 1: Update the CSS unit tests**

Replace the `'declares grid template for 1, 2, 3 column variants and a responsive collapse'` test in `packages/editor/src/styles/content.test.ts` with this block:

```ts
  it('declares column-layout as a flex container with column children using --column-width', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.anynote-editor \.column-layout[\s\S]*display:\s*flex/)
    expect(css).toMatch(/\.anynote-editor \.column[\s\S]*flex:\s*var\(--column-width,\s*1\)\s*1\s*0/)
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*flex-direction:\s*column/)
  })

  it('declares column-divider hit-zone and visible bar on hover', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.anynote-editor \.column-divider\s*{[\s\S]*cursor:\s*col-resize/)
    expect(css).toMatch(/\.anynote-editor \.column-divider::before[\s\S]*background:\s*transparent/)
    expect(css).toMatch(
      /\.anynote-editor \.column-divider:hover::before[\s\S]*background:\s*var\(--editor-text-muted/,
    )
  })

  it('hides column-divider on narrow viewports', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(
      /@media \(max-width: 600px\)[\s\S]*\.anynote-editor \.column-divider[\s\S]*display:\s*none/,
    )
  })
```

(Keep the `'declares drop targets with primary color'` and `'anchors absolute widgets on every top-level ProseMirror child'` tests as-is.)

- [ ] **Step 2: Run CSS tests to verify they fail**

```bash
pnpm --filter @repo/editor test content
```

Expected: the 3 new tests fail; `'declares drop targets with primary color'` and the anchor test still pass.

- [ ] **Step 3: Update `content.css`**

Open `packages/editor/src/styles/content.css`. Replace the block from `/* Column layout — every top-level child gets position:relative ...` through the closing `}` of the `@media (max-width: 600px)` block with:

```css
/* Column layout — every top-level child gets position:relative so the
   drop-target ::before pseudo-elements anchor to the right element. The
   .column inside a layout also gets it for its own internal indicators. */
.anynote-editor .ProseMirror > * {
  position: relative;
}

.anynote-editor .column-layout {
  position: relative;
  display: flex;
  gap: 24px;
  margin: 0.5rem 0;
}

.anynote-editor .column {
  position: relative;
  flex: var(--column-width, 1) 1 0;
  min-width: 0;
}

/* Divider widgets injected by columnResizePlugin sit in each gap between
   columns. A 12px transparent hit-zone catches mousedown; ::before draws
   the visible bar (transparent until hover or active drag). */
.anynote-editor .column-divider {
  position: absolute;
  left: -12px;
  top: 0;
  bottom: 0;
  width: 12px;
  cursor: col-resize;
  user-select: none;
  z-index: 4;
}

.anynote-editor .column-divider::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: transparent;
  border-radius: 1px;
  transition: background-color 120ms ease;
}

.anynote-editor .column-divider:hover::before,
.anynote-editor .column-divider.is-dragging::before {
  background: var(--editor-text-muted, rgba(0, 0, 0, 0.5));
}

/* Drop targets — the plugin adds .column-drop-target--<zone> to the hovered
   block via Decoration.node; the ::before pseudo-element sits inside the
   target's box so the bar always matches its height/width. */
.anynote-editor .column-drop-target::before {
  content: '';
  position: absolute;
  pointer-events: none;
  background: #1976d2;
  z-index: 5;
}
.anynote-editor .column-drop-target--left::before {
  top: 0;
  left: 0;
  bottom: 0;
  width: 3px;
  border-radius: 2px;
}
.anynote-editor .column-drop-target--right::before {
  top: 0;
  right: 0;
  bottom: 0;
  width: 3px;
  border-radius: 2px;
}
.anynote-editor .column-drop-target--top::before {
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
}
.anynote-editor .column-drop-target--bottom::before {
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
}

@media (max-width: 600px) {
  .anynote-editor .column-layout {
    flex-direction: column;
  }
  .anynote-editor .column-divider {
    display: none;
  }
}
```

(This block removes `.column-layout--1/2/3` rules entirely and replaces the parent layout/column block. The drop-target rules and the responsive `@media` are preserved with updated content.)

- [ ] **Step 4: Run CSS tests to verify they pass**

```bash
pnpm --filter @repo/editor test content
```

Expected: all tests in `content.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/styles/content.css \
        packages/editor/src/styles/content.test.ts
git commit -m "feat(editor): switch column-layout to flexbox + add divider styles

CSS Grid templates keyed on .column-layout--N are gone. Each column
claims share via flex: var(--column-width, 1) 1 0. Dividers get a 12px
hit-zone with a hover-only thin bar, hidden under 600px width."
```

---

## Task 6: Drop placement — remove MAX_COLUMNS cap

**Files:**
- Modify: `packages/editor/src/extensions/drop-placement.ts`

- [ ] **Step 1: Apply the edits**

In `packages/editor/src/extensions/drop-placement.ts`:

1. Delete lines 9-10 (the `// Mirrors ...` comment and `const MAX_COLUMNS = 3`).
2. In `computeZoneForTarget` ([drop-placement.ts:172-183](packages/editor/src/extensions/drop-placement.ts#L172-L183)), replace:
   ```ts
   const canSide = target.kind === 'cell' ? target.layoutNode.childCount < MAX_COLUMNS : true
   return computeDropZone({ x: event.clientX, y: event.clientY }, dom.getBoundingClientRect(), {
     canSide,
   })
   ```
   with:
   ```ts
   return computeDropZone({ x: event.clientX, y: event.clientY }, dom.getBoundingClientRect(), {
     canSide: true,
   })
   ```
3. In `applyPlacementDrop` ([drop-placement.ts:288-294](packages/editor/src/extensions/drop-placement.ts#L288-L294)), remove the `if (target.layoutNode.childCount >= MAX_COLUMNS) return false` line so the cell-side branch reads:
   ```ts
   } else {
     // LEFT/RIGHT on a cell — insert a sibling cell into the layout.
     const newCell = columnType.create(null, droppedContent)
     const cellInsertPos =
       zone === 'LEFT' ? target.cellPos : target.cellPos + target.cellNode.nodeSize
     tr = insertContent(tr, cellInsertPos, newCell, source)
   }
   ```

- [ ] **Step 2: Run editor tests to verify nothing regresses**

```bash
pnpm --filter @repo/editor test
```

Expected: all unit tests pass.

- [ ] **Step 3: Type-check**

```bash
pnpm check-types --filter @repo/editor
```

Expected: no errors. (`MAX_COLUMNS` was only used in this file; no other reference will break.)

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/drop-placement.ts
git commit -m "feat(editor): drop MAX_COLUMNS=3 cap from drop-placement

Schema now accepts column+, so the runtime guard is redundant. New
columns inserted by drag get the schema-default width: 1."
```

---

## Task 7: Drag handle — exclude columnLayout/column targets

**Files:**
- Modify: `packages/editor/src/components/drag-handle.tsx`

- [ ] **Step 1: Apply the edits**

Replace the contents of `packages/editor/src/components/drag-handle.tsx` with:

```tsx
'use client'

import { useRef, useState, type MouseEvent } from 'react'
import AddIcon from '@mui/icons-material/Add'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { Box, IconButton } from '@mui/material'
import type { Editor } from '@tiptap/core'
import type { DragHandleRule } from '@tiptap/extension-drag-handle'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Node as PMNode } from '@tiptap/pm/model'

import { DragHandleMenu } from './drag-handle-menu'

const CONTAINER_TYPES = ['callout', 'toggle', 'hiddenText']

// First child of a container block is not independently draggable — dragging
// the first row should pick the parent container instead. Mirrors the library's
// built-in `listItemFirstChild` rule but for our block types.
const firstChildOfContainer: DragHandleRule = {
  id: 'firstChildOfContainer',
  evaluate: ({ parent, isFirst }) => {
    if (!isFirst || !parent) return 0
    return CONTAINER_TYPES.includes(parent.type.name) ? 1000 : 0
  },
}

// columnLayout / column are structural — the user never drags the row or the
// cell itself; only blocks of content inside cells get a handle. Deduct enough
// to push the score < 0, which the library treats as "not a candidate".
const excludeColumnNodes: DragHandleRule = {
  id: 'excludeColumnNodes',
  evaluate: ({ node }) => {
    if (node.type.name === 'columnLayout' || node.type.name === 'column') return 10000
    return 0
  },
}

// `edgeDetection: 'none'` disables the 12px band where deeper nodes lose score
// near their left edge. With it on, mousing from an inner block toward the
// handle (which sits in the gutter) would flip the target to the parent mid-
// motion, so the handle would jump to the outer container before the cursor
// even reached it.
const nestedOptions = {
  rules: [firstChildOfContainer, excludeColumnNodes],
  edgeDetection: 'none' as const,
}

type Props = {
  editor: Editor
  onRequestBlockMove?: (pos: number) => void
}

type HoverNodePos = {
  from: number
  to: number
  isEmpty: boolean
} | null

export function EditorDragHandle({ editor, onRequestBlockMove }: Props) {
  const hoverNodeRef = useRef<HoverNodePos>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuPos, setMenuPos] = useState<number | null>(null)

  const onNodeChange = ({ node, pos }: { node: PMNode | null; editor: Editor; pos: number }) => {
    if (!node) {
      hoverNodeRef.current = null
      return
    }
    hoverNodeRef.current = {
      from: pos,
      to: pos + node.nodeSize,
      isEmpty: node.textContent.length === 0,
    }
  }

  const onElementDragStart = (event: DragEvent) => {
    const info = hoverNodeRef.current
    if (!info || !event.dataTransfer) return
    const dom = editor.view.nodeDOM(info.from) as HTMLElement | null
    if (!dom) return
    const rect = dom.getBoundingClientRect()
    // Upstream's dragHandler builds an off-screen clone wrapper and anchors
    // the drag image via `event.clientX - wrapperRect.left`. Because the
    // wrapper sits at body.left ≈ 0, the preview jumps to the viewport's
    // left edge whenever the block lives in the centered reading column.
    // Shadow setDragImage so the library's call re-anchors to the *original*
    // block's rect — the ghost then stays under the cursor where it was
    // grabbed.
    const nativeSet = event.dataTransfer.setDragImage.bind(event.dataTransfer)
    Object.defineProperty(event.dataTransfer, 'setDragImage', {
      configurable: true,
      value: (image: Element) => {
        const width = (image as HTMLElement).getBoundingClientRect().width || rect.width
        const x = Math.max(0, Math.min(event.clientX - rect.left, width))
        const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
        nativeSet(image, x, y)
      },
    })
  }

  const openSlashMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const info = hoverNodeRef.current
    if (!info) return
    const alt = event.altKey
    const chain = editor.chain().focus()
    if (alt) {
      chain
        .insertContentAt(info.from, { type: 'paragraph' })
        .setTextSelection(info.from + 1)
        .insertContent('/')
        .run()
      return
    }
    if (info.isEmpty) {
      chain
        .setTextSelection(info.from + 1)
        .insertContent('/')
        .run()
      return
    }
    chain
      .setTextSelection(info.to - 1)
      .insertContentAt(info.to, { type: 'paragraph' })
      .setTextSelection(info.to + 1)
      .insertContent('/')
      .run()
  }

  const openBlockMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const info = hoverNodeRef.current
    if (!info) return
    setMenuAnchor(event.currentTarget)
    setMenuPos(info.from)
  }

  const closeBlockMenu = () => {
    setMenuAnchor(null)
    setMenuPos(null)
  }

  return (
    <>
      <DragHandle
        editor={editor}
        nested={nestedOptions}
        onNodeChange={onNodeChange}
        onElementDragStart={onElementDragStart}
      >
        <Box
          className="tiptap-drag-handle-wrapper"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            color: 'text.disabled',
          }}
        >
          <IconButton
            size="small"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={openSlashMenu}
            sx={{ p: 0.25, color: 'text.secondary' }}
            aria-label="Добавить блок"
          >
            <AddIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={openBlockMenu}
            sx={{ p: 0.25, cursor: 'grab', color: 'text.secondary' }}
            aria-label="Действия блока"
          >
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
        </Box>
      </DragHandle>
      <DragHandleMenu
        editor={editor}
        anchorEl={menuAnchor}
        pos={menuPos}
        onClose={closeBlockMenu}
        onRequestMove={onRequestBlockMove ?? (() => undefined)}
      />
    </>
  )
}
```

What changed vs. the current file:
- Added `excludeColumnNodes` rule and included it in `nestedOptions.rules`.
- `HoverNodePos` no longer carries `kind`, `rowFrom`, `rowTo`, `cellFrom`, `cellTo`.
- `onNodeChange` no longer walks ancestors looking for `columnLayout`.
- `DragHandleMenu` no longer receives a `context` prop.

- [ ] **Step 2: Run editor tests + type-check**

```bash
pnpm --filter @repo/editor test
pnpm check-types --filter @repo/editor
```

Expected: all unit tests pass (no editor unit tests touch this component directly). Type-check passes — Step 8 updates `DragHandleMenu`'s signature to match.

If type-check fails on `DragHandleMenu` props (because `context` is still in its type), continue to Task 8; the gates run at the very end.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/components/drag-handle.tsx
git commit -m "feat(editor): hide drag handle on columnLayout/column nodes

New DragHandleRule excludes columnLayout and column from being picked
as drag targets. Hover over the row/cell itself no longer shows the
+/⋮⋮ controls; hover over content inside a cell still does."
```

---

## Task 8: Drag handle menu — remove cell/row dead code

**Files:**
- Modify: `packages/editor/src/components/drag-handle-menu.tsx`

- [ ] **Step 1: Apply the edits**

Open `packages/editor/src/components/drag-handle-menu.tsx`.

1. Replace the `Props` type ([drag-handle-menu.tsx:32-45](packages/editor/src/components/drag-handle-menu.tsx#L32-L45)) with:

```tsx
type Props = {
  editor: Editor
  anchorEl: HTMLElement | null
  pos: number | null
  onClose: () => void
  onRequestMove: (pos: number) => void
}
```

2. Remove the `context` parameter from the `DragHandleMenu` destructure ([drag-handle-menu.tsx:49-56](packages/editor/src/components/drag-handle-menu.tsx#L49-L56)) so the function signature reads:

```tsx
export function DragHandleMenu({ editor, anchorEl, pos, onClose, onRequestMove }: Props) {
```

3. Delete `handleDeleteRow`, `handleDeleteCell`, `handleUnwrapCell` functions ([drag-handle-menu.tsx:133-160](packages/editor/src/components/drag-handle-menu.tsx#L133-L160)).

4. Delete the three trailing `{context?.kind === 'cell' && ...}` JSX blocks inside the first `<Menu>` ([drag-handle-menu.tsx:221-246](packages/editor/src/components/drag-handle-menu.tsx#L221-L246)) — the "Развернуть ячейку", "Удалить ячейку", "Удалить ряд" items.

After the edits, the file should have no remaining references to `context`, `cellFrom`, `cellTo`, `rowFrom`, or `rowTo`.

- [ ] **Step 2: Run editor tests + type-check**

```bash
pnpm --filter @repo/editor test
pnpm check-types --filter @repo/editor
```

Expected: type-check passes. The `Props` of `DragHandleMenu` now matches what `EditorDragHandle` passes.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/components/drag-handle-menu.tsx
git commit -m "refactor(editor): drop cell/row dead code from drag handle menu

With columnLayout/column excluded from drag-handle targeting, the
'Удалить ячейку', 'Удалить ряд', 'Развернуть ячейку' menu items can
never be reached. Removed them along with their context plumbing."
```

---

## Task 9: Dissolve regression — 4-cell case

**Files:**
- Modify: `packages/editor/src/extensions/column-layout.dissolve.test.ts`

- [ ] **Step 1: Add a new test**

Open `packages/editor/src/extensions/column-layout.dissolve.test.ts`. Add this test inside the `describe('dissolveColumnLayouts', ...)` block (after the existing `'removes an empty middle column from a 3-column layout'` test):

```ts
  it('removes an empty middle column from a 4-column layout', () => {
    const state = stateFrom(
      lay(col(para('a')), col(para('')), col(para('c')), col(para('d'))),
    )
    const tr = dissolveColumnLayouts(state)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!).doc
    const layout = next.firstChild!
    expect(layout.type.name).toBe('columnLayout')
    expect(layout.childCount).toBe(3)
    expect(layout.child(0).textContent).toBe('a')
    expect(layout.child(1).textContent).toBe('c')
    expect(layout.child(2).textContent).toBe('d')
  })

  it('leaves a 5-column layout alone when every cell has content', () => {
    const state = stateFrom(
      lay(
        col(para('a')),
        col(para('b')),
        col(para('c')),
        col(para('d')),
        col(para('e')),
      ),
    )
    expect(dissolveColumnLayouts(state)).toBeNull()
  })
```

- [ ] **Step 2: Run dissolve tests**

```bash
pnpm --filter @repo/editor test column-layout.dissolve
```

Expected: all tests pass (no logic change in the dissolve module; these tests pre-validate that the existing implementation generalizes).

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/column-layout.dissolve.test.ts
git commit -m "test(editor): regression for dissolve with 4+ column layouts"
```

---

## Task 10: Playwright e2e — new scenarios + rename

**Files:**
- Modify: `apps/e2e/page-columns.spec.ts`

- [ ] **Step 1: Rename the existing 3-column-removal test**

In `apps/e2e/page-columns.spec.ts`, find the `test('dragging content out of a 3-column row removes the emptied column', ...)` (around [page-columns.spec.ts:300](apps/e2e/page-columns.spec.ts#L300)) and rename the title to `'dragging content out of a multi-column row removes the emptied column'`. Body stays unchanged.

- [ ] **Step 2: Append the new tests**

Append the following tests at the end of `apps/e2e/page-columns.spec.ts`:

```ts
test('drag a paragraph past the right edge of a 3-column row → 4-column row', async ({ page }) => {
  const editor = await createSeededPage(page, 'cols-4', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo', 'Charlie'), paragraph('Delta')],
  })

  const layout = page.locator('.column-layout').first()
  const delta = page.locator('.ProseMirror > p', { hasText: 'Delta' })
  const layoutBox = await layout.boundingBox()
  if (!layoutBox) throw new Error('layout not visible')

  await dragBlockTo(
    page,
    delta,
    layoutBox.x + layoutBox.width + 24,
    layoutBox.y + layoutBox.height / 2,
  )

  const cells = page.locator('.column-layout > .column')
  await expect(cells).toHaveCount(4, { timeout: 5_000 })
  await expect(cells.nth(0)).toContainText('Alpha')
  await expect(cells.nth(1)).toContainText('Bravo')
  await expect(cells.nth(2)).toContainText('Charlie')
  await expect(cells.nth(3)).toContainText('Delta')

  await expect
    .poll(async () => topLevelNonEmptyBlocks(editor))
    .toEqual([expect.objectContaining({ className: expect.stringContaining('column-layout') })])
})

test('dragging the divider redistributes width between adjacent columns', async ({ page }) => {
  await createSeededPage(page, 'cols-resize', {
    type: 'doc',
    content: [columnLayout('Left', 'Right')],
  })

  const cells = page.locator('.column-layout > .column')
  const divider = page.locator('.column-divider').first()
  const dividerBox = await divider.boundingBox()
  if (!dividerBox) throw new Error('divider not visible')

  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dividerBox.x + 120, dividerBox.y + dividerBox.height / 2, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => cells.nth(0).evaluate((el) => Number(el.dataset.width))).toBeGreaterThan(1)
  await expect.poll(async () => cells.nth(1).evaluate((el) => Number(el.dataset.width))).toBeLessThan(1)

  const sum = await cells.evaluateAll((nodes) =>
    nodes.reduce((acc, node) => acc + Number((node as HTMLElement).dataset.width || '0'), 0),
  )
  expect(sum).toBeCloseTo(2, 1)

  await expect(page.locator('.column-divider')).toHaveCount(1)
})

test('divider drag is clamped so neither neighbor collapses below the minimum', async ({ page }) => {
  await createSeededPage(page, 'cols-resize-clamp', {
    type: 'doc',
    content: [columnLayout('Left', 'Right')],
  })

  const cells = page.locator('.column-layout > .column')
  const divider = page.locator('.column-divider').first()
  const dividerBox = await divider.boundingBox()
  const layoutBox = await page.locator('.column-layout').first().boundingBox()
  if (!dividerBox || !layoutBox) throw new Error('boxes not visible')

  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    layoutBox.x + layoutBox.width + 400,
    dividerBox.y + dividerBox.height / 2,
    { steps: 12 },
  )
  await page.mouse.up()

  // sum is 2; MIN_WIDTH_FRACTION = 0.1 → each side >= 0.2.
  const rightWidth = await cells.nth(1).evaluate((el) => Number(el.dataset.width))
  expect(rightWidth).toBeGreaterThanOrEqual(0.2 - 1e-6)
})

test('drag handle does not show for columnLayout or column on row-edge hover', async ({ page }) => {
  await createSeededPage(page, 'cols-no-handle', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo')],
  })

  const layout = page.locator('.column-layout').first()
  const layoutBox = await layout.boundingBox()
  if (!layoutBox) throw new Error('layout not visible')

  // Hover into the gap area between columns (no content block under cursor).
  await page.mouse.move(layoutBox.x + layoutBox.width / 2, layoutBox.y + 4)

  // Drag handle wrapper should not be visible while hovering structural areas.
  const handle = page.locator('.tiptap-drag-handle-wrapper').first()
  // The handle may exist in the DOM but be hidden via opacity / not anchored
  // to a column-layout-typed node. Either way the user-visible buttons must
  // not be reachable here, so we assert it's not pointer-accessible.
  await expect(handle).toBeHidden({ timeout: 2_000 }).catch(async () => {
    // If the library keeps the element mounted at opacity:0, ensure that's
    // the case rather than fully visible.
    const opacity = await handle.evaluate((el) => getComputedStyle(el).opacity)
    expect(Number(opacity)).toBeLessThan(0.5)
  })

  // Now hover over a paragraph inside a cell — the handle should appear.
  const alpha = page.locator('.column-layout .column p', { hasText: 'Alpha' }).first()
  await alpha.hover()
  await expect(handle).toBeVisible({ timeout: 2_000 })
})

test('drag handle menu has no cell/row actions', async ({ page }) => {
  await createSeededPage(page, 'cols-menu-clean', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo')],
  })

  const alpha = page.locator('.column-layout .column p', { hasText: 'Alpha' }).first()
  await alpha.hover()
  const dragButton = page.locator('.tiptap-drag-handle-wrapper button[aria-label="Действия блока"]').first()
  await expect(dragButton).toBeVisible({ timeout: 5_000 })
  await dragButton.click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible({ timeout: 2_000 })
  await expect(menu.getByText('Удалить ячейку')).toHaveCount(0)
  await expect(menu.getByText('Удалить ряд')).toHaveCount(0)
  await expect(menu.getByText('Развернуть ячейку в блоки')).toHaveCount(0)
})
```

- [ ] **Step 3: Run the new e2e tests in isolation**

Bring up the local stack first if it isn't already:

```bash
docker compose up -d
```

Run the column spec only:

```bash
pnpm exec playwright test apps/e2e/page-columns.spec.ts
```

Expected: all tests in the file pass (the original two + the renamed 3-col-out test + 5 new tests). If any fail, inspect Playwright's HTML report and address before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/page-columns.spec.ts
git commit -m "test(e2e): cover unlimited columns, divider resize, hidden controls

- 4-column creation via drag past 3-column row
- divider drag redistributes width (sum invariant)
- divider drag clamped to MIN_WIDTH_FRACTION
- drag handle hidden for columnLayout/column hovers
- cell/row actions absent from drag-handle menu"
```

---

## Task 11: Final gates

- [ ] **Step 1: Run the full merge gate**

```bash
pnpm gates
```

Expected: `pnpm check-types`, `pnpm lint`, `pnpm build`, `pnpm test` all pass. If any step fails, fix the underlying issue (do not bypass).

- [ ] **Step 2: Confirm the working tree is clean**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 3: Push and open a PR (only if user has asked)**

This step is gated on an explicit user request. Do NOT run automatically.

---

## Summary of commits this plan produces

1. `feat(editor): allow unlimited columns; add per-column width attr`
2. `feat(editor): add computeResizedWidths helper for column dividers`
3. `feat(editor): add columnResizePlugin with divider widgets`
4. `feat(editor): register columnResizePlugin on ColumnLayout extension`
5. `feat(editor): switch column-layout to flexbox + add divider styles`
6. `feat(editor): drop MAX_COLUMNS=3 cap from drop-placement`
7. `feat(editor): hide drag handle on columnLayout/column nodes`
8. `refactor(editor): drop cell/row dead code from drag handle menu`
9. `test(editor): regression for dissolve with 4+ column layouts`
10. `test(e2e): cover unlimited columns, divider resize, hidden controls`
