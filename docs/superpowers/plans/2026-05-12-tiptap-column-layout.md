# Tiptap column layout implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a drag-and-drop column layout in the AnyNote Tiptap editor: dropping a block on the left or right 25% edge of another block splits the row into 2 or 3 columns (max 3); existing vertical drag/drop is preserved.

**Architecture:** Two new ProseMirror nodes (`columnLayout`, `column`) registered top-level only. A single `dropPlacement` plugin replaces the default `dropcursor`: it computes which of four zones (LEFT/RIGHT/TOP/BOTTOM) the dragover cursor occupies over the hover target, draws the matching decoration, and on drop builds the transaction. Auto-dissolution lives in `appendTransaction` on the ColumnLayout extension, runs after every local and remote change, and unwraps rows down to 1 cell.

**Tech Stack:** Tiptap 3.22.3 + ProseMirror (packages/editor), `@tiptap/pm/{model,state,view}`, YJS via HocuspocusProvider, MUI v7 for icons/buttons, vitest for unit tests, Playwright for e2e.

**Spec:** [docs/superpowers/specs/2026-05-12-tiptap-column-layout-design.md](../specs/2026-05-12-tiptap-column-layout-design.md)

---

## Task 1: Pure drop-zone math + unit tests

Build a pure function that computes which zone a cursor falls into. No editor instance, no DOM — just math. We isolate this so the bulk of drop-placement logic is unit-testable.

**Files:**
- Create: `packages/editor/src/extensions/drop-placement.zones.ts`
- Create: `packages/editor/src/extensions/drop-placement.zones.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/editor/src/extensions/drop-placement.zones.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { computeDropZone, type DropZone } from './drop-placement.zones'

const rect = { left: 100, top: 100, right: 300, bottom: 200 } as const
// width = 200, height = 100
// LEFT zone = [100, 150), RIGHT zone = (250, 300]

describe('computeDropZone', () => {
  it('returns LEFT when cursor is in the left 25%', () => {
    expect(computeDropZone({ x: 120, y: 150 }, rect, { canSide: true })).toBe<DropZone>('LEFT')
    expect(computeDropZone({ x: 149, y: 150 }, rect, { canSide: true })).toBe<DropZone>('LEFT')
  })

  it('returns RIGHT when cursor is in the right 25%', () => {
    expect(computeDropZone({ x: 251, y: 150 }, rect, { canSide: true })).toBe<DropZone>('RIGHT')
    expect(computeDropZone({ x: 299, y: 150 }, rect, { canSide: true })).toBe<DropZone>('RIGHT')
  })

  it('returns TOP when cursor is in the middle 50% and upper half', () => {
    expect(computeDropZone({ x: 200, y: 110 }, rect, { canSide: true })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 200, y: 149 }, rect, { canSide: true })).toBe<DropZone>('TOP')
  })

  it('returns BOTTOM when cursor is in the middle 50% and lower half', () => {
    expect(computeDropZone({ x: 200, y: 151 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
    expect(computeDropZone({ x: 200, y: 199 }, rect, { canSide: true })).toBe<DropZone>('BOTTOM')
  })

  it('falls back to TOP/BOTTOM in side zones when canSide is false', () => {
    expect(computeDropZone({ x: 120, y: 110 }, rect, { canSide: false })).toBe<DropZone>('TOP')
    expect(computeDropZone({ x: 251, y: 199 }, rect, { canSide: false })).toBe<DropZone>('BOTTOM')
  })

  it('returns null when cursor is outside the rect', () => {
    expect(computeDropZone({ x: 50, y: 150 }, rect, { canSide: true })).toBeNull()
    expect(computeDropZone({ x: 150, y: 250 }, rect, { canSide: true })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @repo/editor test drop-placement.zones`
Expected: FAIL — `Cannot find module './drop-placement.zones'`

- [ ] **Step 3: Implement**

`packages/editor/src/extensions/drop-placement.zones.ts`:

```ts
export type DropZone = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'

export type DropPoint = { x: number; y: number }

export type DropRect = { left: number; top: number; right: number; bottom: number }

export type ZoneOptions = { canSide: boolean }

const SIDE_FRACTION = 0.25

export function computeDropZone(
  point: DropPoint,
  rect: DropRect,
  options: ZoneOptions,
): DropZone | null {
  if (point.x < rect.left || point.x > rect.right) return null
  if (point.y < rect.top || point.y > rect.bottom) return null
  const width = rect.right - rect.left
  const sideThreshold = width * SIDE_FRACTION
  const inLeftBand = point.x < rect.left + sideThreshold
  const inRightBand = point.x > rect.right - sideThreshold
  if (options.canSide && inLeftBand) return 'LEFT'
  if (options.canSide && inRightBand) return 'RIGHT'
  const midY = rect.top + (rect.bottom - rect.top) / 2
  return point.y < midY ? 'TOP' : 'BOTTOM'
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @repo/editor test drop-placement.zones`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/drop-placement.zones.ts packages/editor/src/extensions/drop-placement.zones.test.ts
git commit -m "feat(editor): pure drop-zone math for column layout"
```

---

## Task 2: Column-layout schema declaration

Declare the two ProseMirror nodes. Schema-only — no commands, no dissolution. Tested via `@tiptap/pm/{model,state}` (no DOM, no Editor instance).

**Files:**
- Create: `packages/editor/src/extensions/column-layout.schema.ts`
- Create: `packages/editor/src/extensions/column-layout.schema.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/editor/src/extensions/column-layout.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'

import { columnLayoutSpec, columnSpec } from './column-layout.schema'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    columnLayout: columnLayoutSpec,
    column: columnSpec,
  },
})

const paragraph = (text = 'hi') => schema.nodes.paragraph.create(null, schema.text(text))

const column = (...children: ReturnType<typeof paragraph>[]) =>
  schema.nodes.column.create(null, children)

const layout = (...cells: ReturnType<typeof column>[]) =>
  schema.nodes.columnLayout.create(null, cells)

describe('column-layout schema', () => {
  it('accepts a layout with 2 columns each containing a paragraph', () => {
    const doc = schema.nodes.doc.create(null, [layout(column(paragraph()), column(paragraph()))])
    expect(() => doc.check()).not.toThrow()
  })

  it('accepts a layout with 3 columns', () => {
    const doc = schema.nodes.doc.create(null, [
      layout(column(paragraph()), column(paragraph()), column(paragraph())),
    ])
    expect(() => doc.check()).not.toThrow()
  })

  it('rejects a layout with 4 columns', () => {
    expect(() =>
      schema.nodes.columnLayout.create(null, [
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
        column(paragraph()),
      ]),
    ).toThrow()
  })

  it('rejects a layout with 0 columns', () => {
    expect(() => schema.nodes.columnLayout.create(null, [])).toThrow()
  })

  it('rejects a column at the top level (must be inside layout)', () => {
    expect(() => schema.nodes.doc.create(null, [column(paragraph())])).toThrow()
  })

  it('rejects a column with no children (block+ requires at least one)', () => {
    expect(() => schema.nodes.column.create(null, [])).toThrow()
  })

  it('renders columnLayout as div[data-type=column-layout] with column count', () => {
    const node = layout(column(paragraph()), column(paragraph()))
    const dom = columnLayoutSpec.toDOM!(node) as [string, Record<string, string>, number]
    expect(dom[0]).toBe('div')
    expect(dom[1]['data-type']).toBe('column-layout')
    expect(dom[1]['data-columns']).toBe('2')
  })

  it('renders column as div[data-type=column]', () => {
    const node = column(paragraph())
    const dom = columnSpec.toDOM!(node) as [string, Record<string, string>, number]
    expect(dom[0]).toBe('div')
    expect(dom[1]['data-type']).toBe('column')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @repo/editor test column-layout.schema`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/editor/src/extensions/column-layout.schema.ts`:

```ts
import { Node } from '@tiptap/core'
import type { NodeSpec } from '@tiptap/pm/model'

// Raw NodeSpecs — exported so unit tests can build a prosemirror-model Schema
// directly without spinning up a Tiptap Editor.
export const columnLayoutSpec: NodeSpec = {
  group: 'block',
  content: 'column{1,3}',
  defining: true,
  isolating: false,
  parseDOM: [{ tag: 'div[data-type="column-layout"]' }],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'column-layout',
      'data-columns': String(node.childCount),
      class: `column-layout column-layout--${node.childCount}`,
    },
    0,
  ],
}

export const columnSpec: NodeSpec = {
  content: 'block+',
  isolating: true,
  parseDOM: [{ tag: 'div[data-type="column"]' }],
  toDOM: () => ['div', { 'data-type': 'column', class: 'column' }, 0],
}

// Tiptap Nodes that mirror the specs above. These are the "schema-only"
// extensions consumed by server-side rendering (no NodeView, no plugins).
// The client extension in `column-layout.ts` extends these with the
// appendTransaction dissolve plugin and NodeViews.
export const ColumnLayoutSchema = Node.create({
  name: 'columnLayout',
  group: 'block',
  content: 'column{1,3}',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column-layout"]' }]
  },
  renderHTML({ node }) {
    return [
      'div',
      {
        'data-type': 'column-layout',
        'data-columns': String(node.childCount),
        class: `column-layout column-layout--${node.childCount}`,
      },
      0,
    ]
  },
})

export const ColumnSchema = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },
  renderHTML() {
    return ['div', { 'data-type': 'column', class: 'column' }, 0]
  },
})
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @repo/editor test column-layout.schema`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/column-layout.schema.ts packages/editor/src/extensions/column-layout.schema.test.ts
git commit -m "feat(editor): schema for columnLayout and column nodes"
```

---

## Task 3: Auto-dissolution pure function

The function takes the current document and returns a transaction (or null) that normalizes any malformed `columnLayout` nodes: 0 non-empty columns → remove layout; 1 non-empty column → unwrap; remove empty columns from 2/3-cell rows.

**Files:**
- Create: `packages/editor/src/extensions/column-layout.dissolve.ts`
- Create: `packages/editor/src/extensions/column-layout.dissolve.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/editor/src/extensions/column-layout.dissolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'

import { columnLayoutSpec, columnSpec } from './column-layout.schema'
import { dissolveColumnLayouts } from './column-layout.dissolve'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    columnLayout: columnLayoutSpec,
    column: columnSpec,
  },
})

const para = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)
const col = (...children: ReturnType<typeof para>[]) =>
  schema.nodes.column.create(null, children)
const lay = (...cells: ReturnType<typeof col>[]) =>
  schema.nodes.columnLayout.create(null, cells)

const stateFrom = (...top: ReturnType<typeof para>[] | ReturnType<typeof lay>[]) =>
  EditorState.create({ schema, doc: schema.nodes.doc.create(null, top) })

describe('dissolveColumnLayouts', () => {
  it('returns null when no layouts need dissolution', () => {
    const state = stateFrom(lay(col(para('a')), col(para('b'))))
    expect(dissolveColumnLayouts(state)).toBeNull()
  })

  it('unwraps a 1-column layout, lifting its children to top level', () => {
    const state = stateFrom(lay(col(para('a'), para('b'))))
    const tr = dissolveColumnLayouts(state)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!).doc
    expect(next.childCount).toBe(2)
    expect(next.child(0).type.name).toBe('paragraph')
    expect(next.child(0).textContent).toBe('a')
    expect(next.child(1).textContent).toBe('b')
  })

  it('removes empty columns from a 3-column layout, keeping the others', () => {
    const state = stateFrom(
      lay(col(para('a')), col(para('')), col(para('c'))),
    )
    // mid column has a paragraph with no text — still a "non-empty" cell because
    // it has a paragraph child. Dissolution removes columns whose entire content
    // is empty — i.e. a column with no children or only zero-size children.
    // Here all three cells have one paragraph child, so dissolution leaves them alone.
    expect(dissolveColumnLayouts(state)).toBeNull()
  })

  it('removes empty columns and may unwrap if only 1 non-empty remains', () => {
    // Build a layout with one cell that has zero children. Schema doesn't
    // allow this at create time, but a transaction can produce a transient
    // invalid state mid-update — we simulate it by removing children via tr.
    const original = stateFrom(lay(col(para('a')), col(para('b'))))
    // Programmatically remove the second column's paragraph:
    const tr = original.tr
    const layoutNode = original.doc.firstChild!
    const secondCol = layoutNode.child(1)
    const secondColStart = 1 + layoutNode.child(0).nodeSize + 1
    tr.delete(secondColStart, secondColStart + secondCol.child(0).nodeSize)
    const intermediate = original.apply(tr)

    const dissolveTr = dissolveColumnLayouts(intermediate)
    expect(dissolveTr).not.toBeNull()
    const next = intermediate.apply(dissolveTr!).doc
    // Empty column removed → only 1 non-empty column → unwrap → top-level paragraph
    expect(next.childCount).toBe(1)
    expect(next.child(0).type.name).toBe('paragraph')
    expect(next.child(0).textContent).toBe('a')
  })

  it('removes a layout that ends up with 0 non-empty columns', () => {
    const original = stateFrom(lay(col(para('a'))))
    const tr = original.tr
    tr.delete(2, 2 + para('a').nodeSize)
    const intermediate = original.apply(tr)
    // Now layout has one column with no children; column itself is invalid
    // (schema requires block+). We treat it as 0 non-empty → remove layout.
    const dissolveTr = dissolveColumnLayouts(intermediate)
    expect(dissolveTr).not.toBeNull()
    const next = intermediate.apply(dissolveTr!).doc
    expect(next.childCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @repo/editor test column-layout.dissolve`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/editor/src/extensions/column-layout.dissolve.ts`:

```ts
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

function isColumnEmpty(column: PMNode): boolean {
  if (column.childCount === 0) return true
  // A column is empty if every child is an empty paragraph (no inline content)
  let empty = true
  column.forEach((child) => {
    if (child.content.size > 0 || child.type.name !== 'paragraph') empty = false
  })
  return empty && column.childCount > 0 ? false : column.childCount === 0
}

export function dissolveColumnLayouts(state: EditorState): Transaction | null {
  const { doc, tr } = state
  let mutated = false
  // Walk top-level children right-to-left so position math stays valid as we splice.
  const layouts: { node: PMNode; pos: number }[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'columnLayout') layouts.push({ node, pos: offset })
  })
  for (let i = layouts.length - 1; i >= 0; i--) {
    const { node: layout, pos } = layouts[i]
    const cells: { node: PMNode; localStart: number; empty: boolean }[] = []
    let cursor = 0
    layout.forEach((cell) => {
      cells.push({ node: cell, localStart: cursor, empty: isColumnEmpty(cell) })
      cursor += cell.nodeSize
    })
    const nonEmpty = cells.filter((c) => !c.empty)

    if (nonEmpty.length === 0) {
      tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + layout.nodeSize))
      mutated = true
      continue
    }

    if (nonEmpty.length === 1) {
      const onlyCell = nonEmpty[0].node
      const inner = onlyCell.content
      tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + layout.nodeSize), inner)
      mutated = true
      continue
    }

    // 2 or 3 non-empty: remove empty cells if any
    const hasEmpty = cells.some((c) => c.empty)
    if (hasEmpty) {
      const replacement = layout.type.create(
        layout.attrs,
        nonEmpty.map((c) => c.node),
      )
      tr.replaceWith(
        tr.mapping.map(pos),
        tr.mapping.map(pos + layout.nodeSize),
        replacement,
      )
      mutated = true
    }
  }
  return mutated ? tr : null
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm --filter @repo/editor test column-layout.dissolve`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/column-layout.dissolve.ts packages/editor/src/extensions/column-layout.dissolve.test.ts
git commit -m "feat(editor): auto-dissolution for column layouts"
```

---

## Task 4: ColumnLayout Tiptap extension (wires schema + dissolution)

Extend the schema Nodes from Task 2 with the dissolution `appendTransaction` plugin. This is the client-side aggregate that gets registered in `buildExtensions`. Task 11 rewrites this same file to add `addNodeView` once the React node-view components exist — this task's version is a stepping stone that boots without React.

**Files:**
- Create: `packages/editor/src/extensions/column-layout.ts`

- [ ] **Step 1: Implement the extension**

`packages/editor/src/extensions/column-layout.ts`:

```ts
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { ColumnLayoutSchema, ColumnSchema } from './column-layout.schema'
import { dissolveColumnLayouts } from './column-layout.dissolve'

const dissolveKey = new PluginKey('columnLayoutDissolve')

export const Column = ColumnSchema

export const ColumnLayout = ColumnLayoutSchema.extend({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dissolveKey,
        appendTransaction(_transactions, _oldState, newState) {
          return dissolveColumnLayouts(newState) ?? undefined
        },
      }),
    ]
  },
})
```

- [ ] **Step 2: Type-check the editor package**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/column-layout.ts
git commit -m "feat(editor): ColumnLayout extension with appendTransaction dissolution"
```

---

## Task 5: Drop-placement plugin — decoration rendering (no drop handler yet)

The plugin listens to `dragover`, finds the hover target's DOM node, computes the zone via the pure function from Task 1, and renders a Decoration. The actual `drop` handling comes in Task 6.

**Files:**
- Create: `packages/editor/src/extensions/drop-placement.ts`

- [ ] **Step 1: Implement the dragover side**

`packages/editor/src/extensions/drop-placement.ts`:

```ts
import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { computeDropZone, type DropZone } from './drop-placement.zones'

type HoverTarget =
  | { kind: 'block'; pos: number; node: PMNode }
  | { kind: 'cell'; cellPos: number; cellNode: PMNode; layoutPos: number; layoutNode: PMNode; cellIndex: number }

type PluginState = { zone: DropZone | null; target: HoverTarget | null }

export const dropPlacementKey = new PluginKey<PluginState>('dropPlacement')

function resolveHoverTarget(view: EditorView, $pos: ResolvedPos): HoverTarget | null {
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth)
    if (node.type.name === 'column') {
      const layoutNode = $pos.node(depth - 1)
      const layoutPos = $pos.before(depth - 1)
      const cellPos = $pos.before(depth)
      const cellIndex = $pos.index(depth - 1)
      return { kind: 'cell', cellPos, cellNode: node, layoutPos, layoutNode, cellIndex }
    }
    if (depth === 1) {
      // top-level child of doc
      const pos = $pos.before(depth)
      return { kind: 'block', pos, node }
    }
  }
  return null
}

function renderIndicatorDecoration(state: PluginState): DecorationSet {
  // Decoration via `Decoration.widget` placed at the target node's start, with
  // an absolutely-positioned overlay so CSS handles the visual.
  if (!state.zone || !state.target) return DecorationSet.empty
  const target = state.target
  const targetPos = target.kind === 'cell' ? target.cellPos : target.pos
  const overlay = document.createElement('div')
  overlay.className = `column-drop-indicator column-drop-indicator--${state.zone.toLowerCase()}`
  overlay.setAttribute('aria-hidden', 'true')
  // Use a widget decoration anchored at the *start* of the target node.
  // The overlay positions itself via CSS absolute against the target's wrapper.
  return DecorationSet.empty.add(
    state.target.kind === 'cell' ? state.target.cellNode.content : state.target.node.content,
    [
      Decoration.widget(targetPos + 1, overlay, { side: -1, ignoreSelection: true, key: `drop-${state.zone}` }),
    ],
  )
}

export const DropPlacement = Extension.create({
  name: 'dropPlacement',
  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: dropPlacementKey,
        state: {
          init: () => ({ zone: null, target: null }),
          apply(tr, value) {
            const meta = tr.getMeta(dropPlacementKey) as PluginState | undefined
            return meta ?? value
          },
        },
        props: {
          decorations(state) {
            return renderIndicatorDecoration(dropPlacementKey.getState(state)!)
          },
          handleDOMEvents: {
            dragover(view, event) {
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
              if (!pos) {
                view.dispatch(view.state.tr.setMeta(dropPlacementKey, { zone: null, target: null }))
                return false
              }
              const $pos = view.state.doc.resolve(pos.pos)
              const target = resolveHoverTarget(view, $pos)
              if (!target) {
                view.dispatch(view.state.tr.setMeta(dropPlacementKey, { zone: null, target: null }))
                return false
              }
              const targetDomPos = target.kind === 'cell' ? target.cellPos : target.pos
              const dom = view.nodeDOM(targetDomPos) as HTMLElement | null
              if (!dom) return false
              const rect = dom.getBoundingClientRect()
              const canSide =
                target.kind === 'cell'
                  ? target.layoutNode.childCount < 3
                  : true
              const zone = computeDropZone({ x: event.clientX, y: event.clientY }, rect, { canSide })
              view.dispatch(view.state.tr.setMeta(dropPlacementKey, { zone, target }))
              event.preventDefault()
              return true
            },
            dragleave(view) {
              view.dispatch(view.state.tr.setMeta(dropPlacementKey, { zone: null, target: null }))
              return false
            },
          },
        },
      }),
    ]
  },
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/drop-placement.ts
git commit -m "feat(editor): drop-placement plugin renders zone decorations"
```

---

## Task 6: Drop-placement — drop handler builds the transaction

Add `handleDrop` to the plugin that uses the captured zone and target to build the correct mutation. Source range comes from `view.dragging.slice` (set by ProseMirror when the drag starts inside the editor).

**Files:**
- Modify: `packages/editor/src/extensions/drop-placement.ts`

- [ ] **Step 1: Add the drop handler**

In `packages/editor/src/extensions/drop-placement.ts`, inside the same `Plugin`'s `props` block, add the `handleDrop` below. Source range for in-editor moves is captured from the current selection (which the row/cell NodeViews set on `dragstart`, and the existing `EditorDragHandle` sets via PM's standard drag flow).

```ts
handleDrop(view, event, slice, moved) {
  const placement = dropPlacementKey.getState(view.state)
  if (!placement?.zone || !placement.target) return false

  const { zone, target } = placement
  let tr = view.state.tr

  // For in-editor moves, capture the source range *before* we insert anywhere
  // (positions before insertion are stable).
  let sourceFrom: number | null = null
  let sourceTo: number | null = null
  if (moved && view.dragging) {
    const dragSelection = view.dragging.move ? view.state.selection : null
    if (dragSelection && !dragSelection.empty) {
      sourceFrom = dragSelection.from
      sourceTo = dragSelection.to
    }
  }

  const schema = view.state.schema
  const columnType = schema.nodes.column
  const layoutType = schema.nodes.columnLayout
  if (!columnType || !layoutType) return false

  if (zone === 'TOP' || zone === 'BOTTOM') {
    const insertPos =
      target.kind === 'cell'
        ? zone === 'TOP'
          ? target.cellPos + 1
          : target.cellPos + target.cellNode.nodeSize - 1
        : zone === 'TOP'
          ? target.pos
          : target.pos + target.node.nodeSize
    if (sourceFrom !== null && sourceTo !== null) {
      tr = tr.delete(sourceFrom, sourceTo)
      // Re-map insertPos through the deletion mapping
      const mapped = tr.mapping.map(insertPos)
      tr.insert(mapped, slice.content)
    } else {
      tr.insert(insertPos, slice.content)
    }
  } else {
    // LEFT or RIGHT — column work
    const newCell = columnType.create(null, slice.content)

    if (target.kind === 'block') {
      const wrappedCells =
        zone === 'LEFT'
          ? [newCell, columnType.create(null, target.node)]
          : [columnType.create(null, target.node), newCell]
      const layout = layoutType.create(null, wrappedCells)
      if (sourceFrom !== null && sourceTo !== null) {
        tr = tr.delete(sourceFrom, sourceTo)
        const start = tr.mapping.map(target.pos)
        const end = tr.mapping.map(target.pos + target.node.nodeSize)
        tr.replaceWith(start, end, layout)
      } else {
        tr.replaceWith(target.pos, target.pos + target.node.nodeSize, layout)
      }
    } else {
      if (target.layoutNode.childCount >= 3) return false
      const cellInsertPos =
        zone === 'LEFT' ? target.cellPos : target.cellPos + target.cellNode.nodeSize
      if (sourceFrom !== null && sourceTo !== null) {
        tr = tr.delete(sourceFrom, sourceTo)
        const mapped = tr.mapping.map(cellInsertPos)
        tr.insert(mapped, newCell)
      } else {
        tr.insert(cellInsertPos, newCell)
      }
    }
  }

  view.dispatch(tr.setMeta(dropPlacementKey, { zone: null, target: null }))
  event.preventDefault()
  return true
},
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/drop-placement.ts
git commit -m "feat(editor): drop-placement plugin handles drops into columns"
```

---

## Task 7: CSS — column-layout, columns, indicators, responsive

Add layout styles for rows/cells, drop indicators, and the responsive media query.

**Files:**
- Modify: `packages/editor/src/styles/content.css`
- Modify: `packages/editor/src/styles/content.test.ts`

- [ ] **Step 1: Append CSS rules to `content.css`**

Append to `packages/editor/src/styles/content.css` (at the end, before any final block):

```css
/* Column layout */
.anynote-editor .column-layout {
  display: grid;
  gap: 24px;
  margin: 0.5rem 0;
}
.anynote-editor .column-layout--1 { grid-template-columns: 1fr; }
.anynote-editor .column-layout--2 { grid-template-columns: 1fr 1fr; }
.anynote-editor .column-layout--3 { grid-template-columns: 1fr 1fr 1fr; }

.anynote-editor .column {
  position: relative;
  min-width: 0;
}

/* Drop indicators — overlay on the target node */
.anynote-editor .column-drop-indicator {
  position: absolute;
  pointer-events: none;
  background: #1976d2;
  z-index: 5;
}
.anynote-editor .column-drop-indicator--left {
  top: 0;
  left: 0;
  bottom: 0;
  width: 3px;
  border-radius: 2px;
}
.anynote-editor .column-drop-indicator--right {
  top: 0;
  right: 0;
  bottom: 0;
  width: 3px;
  border-radius: 2px;
}
.anynote-editor .column-drop-indicator--top {
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
}
.anynote-editor .column-drop-indicator--bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
}

@media (max-width: 600px) {
  .anynote-editor .column-layout--2,
  .anynote-editor .column-layout--3 {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Add an assertion in `content.test.ts`**

Append a new `describe` block to `packages/editor/src/styles/content.test.ts`:

```ts
describe('editor column layout styles', () => {
  it('declares grid template for 1, 2, 3 column variants and a responsive collapse', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.column-layout--1[\s\S]*grid-template-columns:\s*1fr\b/)
    expect(css).toMatch(/\.column-layout--2[\s\S]*grid-template-columns:\s*1fr 1fr\b/)
    expect(css).toMatch(/\.column-layout--3[\s\S]*grid-template-columns:\s*1fr 1fr 1fr\b/)
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*grid-template-columns:\s*1fr;/)
  })

  it('declares drop indicators with primary color', () => {
    const css = readFileSync(contentCssPath, 'utf8')
    expect(css).toMatch(/\.column-drop-indicator--left[\s\S]*width:\s*3px/)
    expect(css).toMatch(/\.column-drop-indicator--right[\s\S]*width:\s*3px/)
    expect(css).toMatch(/\.column-drop-indicator\b[\s\S]*background:\s*#1976d2/)
  })
})
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @repo/editor test content`
Expected: PASS (both new describes plus the existing task list one).

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/styles/content.css packages/editor/src/styles/content.test.ts
git commit -m "feat(editor): column layout and drop indicator styles"
```

---

## Task 8: Wire into `buildExtensions`

Disable StarterKit's default `dropcursor`, register the two new ColumnLayout extensions and the DropPlacement plugin.

**Files:**
- Modify: `packages/editor/src/extensions/index.ts`

- [ ] **Step 1: Make edits**

In `packages/editor/src/extensions/index.ts`:

Replace the line:

```ts
StarterKit.configure({ undoRedo: false }),
```

with:

```ts
StarterKit.configure({ undoRedo: false, dropcursor: false }),
```

Add imports at the top alongside the others:

```ts
import { Column, ColumnLayout } from './column-layout'
import { DropPlacement } from './drop-placement'
```

Inside the `buildExtensions` array, after the existing `BlockIndexAttributes` line and before the closing `]`, add:

```ts
ColumnLayout,
Column,
DropPlacement,
```

- [ ] **Step 2: Type-check + build**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor build`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/index.ts
git commit -m "feat(editor): register column-layout and drop-placement"
```

---

## Task 9: Drag handle — distinguish row vs cell vs block

`EditorDragHandle.onNodeChange` currently captures the hovered top-level node only. Extend it so that when the hovered DOM is inside a `column`, the handle understands it can drag (a) the whole row from the gutter handle or (b) just the cell from a small inner handle.

**Files:**
- Modify: `packages/editor/src/components/drag-handle.tsx`

- [ ] **Step 1: Read current state**

Re-read `packages/editor/src/components/drag-handle.tsx` for current `HoverNodePos` type and `onNodeChange` logic.

- [ ] **Step 2: Replace the hover-node tracking**

Expand the type and tracking. Replace:

```ts
type HoverNodePos = { from: number; to: number; isEmpty: boolean } | null
```

with:

```ts
type HoverKind = 'block' | 'cell'
type HoverNodePos = {
  from: number
  to: number
  isEmpty: boolean
  kind: HoverKind
  rowFrom?: number
  rowTo?: number
  cellIndex?: number
} | null
```

Replace the `onNodeChange` callback body:

```ts
const onNodeChange = ({ node, pos, editor: ed }: { node: PMNode | null; editor: Editor; pos: number }) => {
  if (!node) {
    hoverNodeRef.current = null
    return
  }
  const $pos = ed.state.doc.resolve(pos + 1)
  let kind: HoverKind = 'block'
  let rowFrom: number | undefined
  let rowTo: number | undefined
  let cellIndex: number | undefined
  for (let d = $pos.depth; d >= 0; d--) {
    const ancestor = $pos.node(d)
    if (ancestor.type.name === 'columnLayout') {
      kind = 'cell'
      rowFrom = $pos.before(d)
      rowTo = rowFrom + ancestor.nodeSize
      cellIndex = $pos.index(d)
      break
    }
  }
  hoverNodeRef.current = {
    from: pos,
    to: pos + node.nodeSize,
    isEmpty: node.textContent.length === 0,
    kind,
    rowFrom,
    rowTo,
    cellIndex,
  }
}
```

- [ ] **Step 3: Type-check + manual smoke**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/components/drag-handle.tsx
git commit -m "feat(editor): drag-handle distinguishes row, cell, and block contexts"
```

---

## Task 10: Drag handle menu — row/cell-specific items

When the hovered node is inside a column, the menu under the drag handle should offer row-level and cell-level operations: "Delete row", "Delete cell", "Unwrap cell to blocks".

**Files:**
- Modify: `packages/editor/src/components/drag-handle-menu.tsx`
- Modify: `packages/editor/src/components/drag-handle.tsx` (pass new context to menu)

- [ ] **Step 1: Read current menu file**

Read `packages/editor/src/components/drag-handle-menu.tsx` and note the existing prop names and `pos` usage.

- [ ] **Step 2: Extend props**

Add to `DragHandleMenuProps` (or whatever it's called in the file):

```ts
context?: {
  kind: 'block' | 'cell'
  rowFrom?: number
  rowTo?: number
  cellFrom?: number
  cellTo?: number
}
```

- [ ] **Step 3: Conditionally render row/cell items**

After the existing menu items, before the closing `</Menu>`, add:

```tsx
{context?.kind === 'cell' && context.rowFrom !== undefined && context.rowTo !== undefined && (
  <MenuItem
    onClick={() => {
      editor.chain().focus().deleteRange({ from: context.rowFrom!, to: context.rowTo! }).run()
      onClose()
    }}
  >
    Удалить ряд
  </MenuItem>
)}
{context?.kind === 'cell' && context.cellFrom !== undefined && context.cellTo !== undefined && (
  <>
    <MenuItem
      onClick={() => {
        editor.chain().focus().deleteRange({ from: context.cellFrom!, to: context.cellTo! }).run()
        onClose()
      }}
    >
      Удалить ячейку
    </MenuItem>
    <MenuItem
      onClick={() => {
        // Unwrap: replace cell with its children at parent position
        const { state } = editor
        const $from = state.doc.resolve(context.cellFrom! + 1)
        const cellNode = $from.parent
        const layoutPos = $from.before($from.depth - 1)
        const layoutNode = state.doc.nodeAt(layoutPos)
        if (!layoutNode) return onClose()
        // Replace entire layout with cell contents (auto-dissolve will tidy)
        editor
          .chain()
          .focus()
          .deleteRange({ from: context.cellFrom!, to: context.cellTo! })
          .run()
        onClose()
      }}
    >
      Развернуть ячейку в блоки
    </MenuItem>
  </>
)}
```

- [ ] **Step 4: Pass context from drag-handle.tsx**

In `drag-handle.tsx`, where `<DragHandleMenu ... />` is rendered, add the `context` prop computed from `hoverNodeRef.current`:

```tsx
<DragHandleMenu
  editor={editor}
  anchorEl={menuAnchor}
  pos={menuPos}
  onClose={closeBlockMenu}
  onRequestMove={onRequestBlockMove ?? (() => undefined)}
  context={
    hoverNodeRef.current
      ? {
          kind: hoverNodeRef.current.kind,
          rowFrom: hoverNodeRef.current.rowFrom,
          rowTo: hoverNodeRef.current.rowTo,
          cellFrom: hoverNodeRef.current.kind === 'cell' ? hoverNodeRef.current.from : undefined,
          cellTo: hoverNodeRef.current.kind === 'cell' ? hoverNodeRef.current.to : undefined,
        }
      : undefined
  }
/>
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/components/drag-handle-menu.tsx packages/editor/src/components/drag-handle.tsx
git commit -m "feat(editor): row/cell delete and unwrap menu items"
```

---

## Task 11: NodeViews with row and cell drag handles

Render the row's `⠿` handle at the top-left of `columnLayout` and a smaller `⠿` at the top-left of each `column`. Both buttons are `draggable="true"`. On `dragstart` they set a `NodeSelection` on the row/cell so ProseMirror picks the right slice; on `click` they open a small Material UI Menu (Move / Delete / Unwrap).

**Files:**
- Create: `packages/editor/src/components/column-layout-node-view.tsx`
- Create: `packages/editor/src/components/column-node-view.tsx`
- Modify: `packages/editor/src/extensions/column-layout.ts` (wire `addNodeView` for both)
- Modify: `packages/editor/src/styles/content.css` (positioning for `.row-drag-handle` and `.cell-drag-handle`)

- [ ] **Step 1: Create the row node view**

`packages/editor/src/components/column-layout-node-view.tsx`:

```tsx
'use client'

import { useState, type DragEvent, type MouseEvent } from 'react'
import { IconButton, Menu, MenuItem } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

export function ColumnLayoutNodeView({ editor, getPos, node }: NodeViewProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const selectRow = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
    editor.view.dispatch(tr)
  }

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    selectRow()
    // Let ProseMirror's built-in drag flow handle the rest — it reads from
    // view.state.selection (now a NodeSelection on the row) and the
    // dropPlacement plugin handles where it lands.
  }

  const onOpenMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    selectRow()
    setAnchor(event.currentTarget)
  }

  const closeMenu = () => setAnchor(null)

  const deleteRow = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
    closeMenu()
  }

  return (
    <NodeViewWrapper
      as="div"
      data-type="column-layout"
      data-columns={String(node.childCount)}
      className={`column-layout column-layout--${node.childCount}`}
    >
      <IconButton
        className="row-drag-handle"
        size="small"
        draggable
        onDragStart={onDragStart}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onOpenMenu}
        aria-label="Действия ряда"
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <NodeViewContent as="div" className="column-layout-content" />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
        <MenuItem onClick={deleteRow}>Удалить ряд</MenuItem>
      </Menu>
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 2: Create the cell node view**

`packages/editor/src/components/column-node-view.tsx`:

```tsx
'use client'

import { useState, type DragEvent, type MouseEvent } from 'react'
import { IconButton, Menu, MenuItem } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'

export function ColumnNodeView({ editor, getPos, node }: NodeViewProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const selectCell = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
    editor.view.dispatch(tr)
  }

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    selectCell()
  }

  const onOpenMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    selectCell()
    setAnchor(event.currentTarget)
  }

  const closeMenu = () => setAnchor(null)

  const deleteCell = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
    closeMenu()
  }

  const unwrapCell = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    // Replace the cell with its content at the same position; the surrounding
    // layout will auto-dissolve if this leaves only one cell.
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const $pos = state.doc.resolve(pos)
        const cell = $pos.nodeAfter
        if (!cell || cell.type.name !== 'column') return false
        tr.replaceWith(pos, pos + cell.nodeSize, cell.content)
        return true
      })
      .run()
    closeMenu()
  }

  return (
    <NodeViewWrapper as="div" data-type="column" className="column">
      <IconButton
        className="cell-drag-handle"
        size="small"
        draggable
        onDragStart={onDragStart}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onOpenMenu}
        aria-label="Действия ячейки"
      >
        <DragIndicatorIcon fontSize="inherit" />
      </IconButton>
      <NodeViewContent as="div" className="column-content" />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
        <MenuItem onClick={deleteCell}>Удалить ячейку</MenuItem>
        <MenuItem onClick={unwrapCell}>Развернуть ячейку в блоки</MenuItem>
      </Menu>
    </NodeViewWrapper>
  )
}
```

- [ ] **Step 3: Wire node views into the extensions**

Edit `packages/editor/src/extensions/column-layout.ts` to attach NodeViews via `.extend`. Replace the entire file contents with:

```ts
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { ColumnLayoutSchema, ColumnSchema } from './column-layout.schema'
import { dissolveColumnLayouts } from './column-layout.dissolve'
import { ColumnLayoutNodeView } from '../components/column-layout-node-view'
import { ColumnNodeView } from '../components/column-node-view'

const dissolveKey = new PluginKey('columnLayoutDissolve')

export const Column = ColumnSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ColumnNodeView)
  },
})

export const ColumnLayout = ColumnLayoutSchema.extend({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: dissolveKey,
        appendTransaction(_transactions, _oldState, newState) {
          return dissolveColumnLayouts(newState) ?? undefined
        },
      }),
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(ColumnLayoutNodeView)
  },
})
```

- [ ] **Step 4: Append handle positioning to CSS**

Append to `packages/editor/src/styles/content.css`:

```css
/* Row drag handle — sits in the gutter to the left of the row */
.anynote-editor .column-layout {
  position: relative;
}
.anynote-editor .row-drag-handle {
  position: absolute;
  left: -32px;
  top: 4px;
  opacity: 0;
  transition: opacity 120ms ease;
  padding: 2px;
}
.anynote-editor .column-layout:hover .row-drag-handle,
.anynote-editor .row-drag-handle:focus-visible {
  opacity: 1;
}

/* Cell drag handle — small, top-left inside each cell */
.anynote-editor .column {
  padding-left: 20px;
}
.anynote-editor .cell-drag-handle {
  position: absolute;
  left: 0;
  top: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
  padding: 0;
  font-size: 14px;
}
.anynote-editor .column:hover .cell-drag-handle,
.anynote-editor .cell-drag-handle:focus-visible {
  opacity: 1;
}
```

- [ ] **Step 5: Append CSS test assertions**

In `packages/editor/src/styles/content.test.ts`, add to the existing `describe('editor column layout styles', ...)` block:

```ts
it('positions row drag handle in the gutter and hides until hover', () => {
  const css = readFileSync(contentCssPath, 'utf8')
  expect(css).toMatch(/\.row-drag-handle\b[\s\S]*left:\s*-32px/)
  expect(css).toMatch(/\.row-drag-handle\b[\s\S]*opacity:\s*0/)
  expect(css).toMatch(/\.column-layout:hover \.row-drag-handle[\s\S]*opacity:\s*1/)
})

it('renders a small cell drag handle inside each column', () => {
  const css = readFileSync(contentCssPath, 'utf8')
  expect(css).toMatch(/\.cell-drag-handle\b[\s\S]*position:\s*absolute/)
  expect(css).toMatch(/\.column:hover \.cell-drag-handle[\s\S]*opacity:\s*1/)
})
```

- [ ] **Step 6: Type-check + tests**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/components/column-layout-node-view.tsx packages/editor/src/components/column-node-view.tsx packages/editor/src/extensions/column-layout.ts packages/editor/src/styles/content.css packages/editor/src/styles/content.test.ts
git commit -m "feat(editor): node views with row and cell drag handles"
```

---

## Task 12: Block-index attributes — composite key for cell-nested blocks

`BlockIndexAttributes` decorates top-level nodes with `data-block-index="N"`. With columns, deep-link scroll targets need to resolve to inner blocks. Extend the plugin to additionally decorate cell-nested blocks with `data-block-index="rowIdx.cellIdx.innerIdx"`.

**Files:**
- Modify: `packages/editor/src/extensions/block-index-attributes.ts`

- [ ] **Step 1: Edit the plugin**

Replace the `decorations(state)` function body inside the existing plugin with:

```ts
decorations(state) {
  const decos: Decoration[] = []
  const flashIndex = blockFlashKey.getState(state)?.flashIndex ?? null
  state.doc.content.forEach((node, offset, index) => {
    const baseAttrs: Record<string, string> = { 'data-block-index': String(index) }
    if (index === flashIndex) baseAttrs.class = 'block-flash'
    decos.push(Decoration.node(offset, offset + node.nodeSize, baseAttrs))

    if (node.type.name === 'columnLayout') {
      let cellOffset = offset + 1 // step into layout
      node.forEach((cell, _co, cellIdx) => {
        let innerOffset = cellOffset + 1 // step into cell
        cell.forEach((inner, _io, innerIdx) => {
          decos.push(
            Decoration.node(innerOffset, innerOffset + inner.nodeSize, {
              'data-block-index': `${index}.${cellIdx}.${innerIdx}`,
            }),
          )
          innerOffset += inner.nodeSize
        })
        cellOffset += cell.nodeSize
      })
    }
  })
  return DecorationSet.create(state.doc, decos)
},
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/block-index-attributes.ts
git commit -m "feat(editor): composite block-index for cell-nested blocks"
```

---

## Task 13: Server schema registration

`packages/editor/src/extensions/server.ts` is a schema-only barrel that re-exports `*.schema.ts` exports for server-side rendering (no React, no NodeViews, no plugins). Add the column nodes from `column-layout.schema.ts` so exported HTML / SSR includes columns correctly.

**Files:**
- Modify: `packages/editor/src/extensions/server.ts`

- [ ] **Step 1: Add the re-export**

Append to `packages/editor/src/extensions/server.ts`, alongside the other `Schema as Name` re-exports:

```ts
export {
  ColumnLayoutSchema as ColumnLayout,
  ColumnSchema as Column,
} from './column-layout.schema'
```

Do NOT re-export from `./column-layout` (that file imports React NodeViews via `./column-layout-node-view` and is not server-safe). Do NOT add `DropPlacement` — it's a browser-only interaction plugin.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/server.ts
git commit -m "feat(editor): register column nodes for server-side rendering"
```

---

## Task 14: Playwright e2e — golden path through column layout

End-to-end test that drives the actual editor in a real browser via the Playwright dev server.

**Files:**
- Create: `apps/e2e/page-columns.spec.ts`

- [ ] **Step 1: Write the test**

`apps/e2e/page-columns.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

import { signUpAndAuthAs, writeConsentsForUserId } from './helpers/auth'

test.describe('column layout drag and drop', () => {
  test('drag block onto right edge creates a 2-column row, then 3-column', async ({ page }) => {
    const { user } = await signUpAndAuthAs(page)
    await writeConsentsForUserId(user.id)

    await page.goto('/app')
    await page.getByRole('button', { name: /Создать страницу|New page/ }).click()
    await page.waitForURL(/\/workspaces\/.+\/pages\/.+/)

    // Type three paragraphs
    const editor = page.locator('.anynote-editor .ProseMirror').first()
    await editor.click()
    await editor.type('Alpha\nBravo\nCharlie')

    // Drag Bravo onto the right edge of Alpha → 2-column row
    const alpha = page.locator('p', { hasText: 'Alpha' }).first()
    const bravo = page.locator('p', { hasText: 'Bravo' }).first()
    const alphaBox = await alpha.boundingBox()
    const bravoBox = await bravo.boundingBox()
    if (!alphaBox || !bravoBox) throw new Error('paragraph not found')

    // Use the drag handle for Bravo
    await bravo.hover()
    const dragHandle = page.locator('.tiptap-drag-handle [aria-label="Действия блока"]').first()
    await dragHandle.hover()
    await page.mouse.down()
    await page.mouse.move(alphaBox.x + alphaBox.width - 8, alphaBox.y + alphaBox.height / 2, { steps: 10 })
    await page.mouse.up()

    await expect(page.locator('.column-layout--2')).toHaveCount(1)
    const cells = page.locator('.column-layout--2 > .column')
    await expect(cells).toHaveCount(2)
    await expect(cells.nth(0)).toContainText('Alpha')
    await expect(cells.nth(1)).toContainText('Bravo')

    // Drag Charlie onto the right edge of the row's second cell
    const charlie = page.locator('p', { hasText: 'Charlie' }).first()
    const secondCellBox = await cells.nth(1).boundingBox()
    if (!secondCellBox) throw new Error('second cell not found')

    await charlie.hover()
    const charlieHandle = page.locator('.tiptap-drag-handle [aria-label="Действия блока"]').first()
    await charlieHandle.hover()
    await page.mouse.down()
    await page.mouse.move(
      secondCellBox.x + secondCellBox.width - 8,
      secondCellBox.y + secondCellBox.height / 2,
      { steps: 10 },
    )
    await page.mouse.up()

    await expect(page.locator('.column-layout--3')).toHaveCount(1)
    await expect(page.locator('.column-layout--3 > .column')).toHaveCount(3)
  })

  test('vertical drag still works for plain blocks', async ({ page }) => {
    const { user } = await signUpAndAuthAs(page)
    await writeConsentsForUserId(user.id)
    await page.goto('/app')
    await page.getByRole('button', { name: /Создать страницу|New page/ }).click()
    await page.waitForURL(/\/workspaces\/.+\/pages\/.+/)

    const editor = page.locator('.anynote-editor .ProseMirror').first()
    await editor.click()
    await editor.type('One\nTwo')

    const one = page.locator('p', { hasText: 'One' }).first()
    const two = page.locator('p', { hasText: 'Two' }).first()
    const twoBox = await two.boundingBox()
    if (!twoBox) throw new Error('two not found')

    await one.hover()
    const handle = page.locator('.tiptap-drag-handle [aria-label="Действия блока"]').first()
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(twoBox.x + twoBox.width / 2, twoBox.y + twoBox.height + 5, { steps: 10 })
    await page.mouse.up()

    const paragraphs = page.locator('.anynote-editor .ProseMirror > p')
    await expect(paragraphs.nth(0)).toHaveText('Two')
    await expect(paragraphs.nth(1)).toHaveText('One')
    await expect(page.locator('.column-layout')).toHaveCount(0)
  })

  test('row dissolves to plain block when dragged-out cell leaves one remaining', async ({ page }) => {
    const { user } = await signUpAndAuthAs(page)
    await writeConsentsForUserId(user.id)
    await page.goto('/app')
    await page.getByRole('button', { name: /Создать страницу|New page/ }).click()
    await page.waitForURL(/\/workspaces\/.+\/pages\/.+/)

    const editor = page.locator('.anynote-editor .ProseMirror').first()
    await editor.click()
    await editor.type('First\nSecond\nThird')

    // Build a row from First + Second
    const first = page.locator('p', { hasText: 'First' }).first()
    const second = page.locator('p', { hasText: 'Second' }).first()
    const firstBox = await first.boundingBox()
    if (!firstBox) throw new Error('first not found')

    await second.hover()
    let handle = page.locator('.tiptap-drag-handle [aria-label="Действия блока"]').first()
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(firstBox.x + firstBox.width - 8, firstBox.y + firstBox.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect(page.locator('.column-layout--2')).toHaveCount(1)

    // Drag Second OUT of the row, above Third → dissolves row
    const third = page.locator('p', { hasText: 'Third' }).first()
    const thirdBox = await third.boundingBox()
    if (!thirdBox) throw new Error('third not found')

    const cellSecond = page.locator('.column', { hasText: 'Second' }).first()
    await cellSecond.hover()
    handle = page.locator('.tiptap-drag-handle [aria-label="Действия блока"]').first()
    await handle.hover()
    await page.mouse.down()
    await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y - 5, { steps: 10 })
    await page.mouse.up()

    await expect(page.locator('.column-layout')).toHaveCount(0)
    const ps = page.locator('.anynote-editor .ProseMirror > p')
    await expect(ps.nth(0)).toContainText('First')
  })
})
```

- [ ] **Step 2: Run e2e**

Run: `pnpm exec playwright test apps/e2e/page-columns.spec.ts`
Expected: 3 tests pass. If they don't, debug — typical failures: drag handle selector mismatch (check actual aria-label in code), timing on `mouse.move` (increase steps), workspace creation flow text differs (adjust button name regex).

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/page-columns.spec.ts
git commit -m "test(e2e): column layout drag-and-drop golden path"
```

---

## Task 15: Gates run + branch summary

Run the merge-gate command from CLAUDE.md to validate the entire workspace before opening a PR.

- [ ] **Step 1: Run gates**

Run: `pnpm gates`
Expected: PASS (check-types + lint + build + test across all packages).

- [ ] **Step 2: Resolve failures (if any)**

Common issues:

- TypeScript: a new type used across multiple files needs to be exported from a single shared location — fix the imports
- Lint: prettier `semi: false` + single quotes — run `pnpm format` if formatting drifted
- Test: a stray reference to the disabled `dropcursor` extension somewhere (search the repo for `dropcursor`)
- Build: a workspace package consuming `@repo/editor` that didn't pick up new exports — confirm no new file paths added to other apps' imports

Iterate until `pnpm gates` is clean.

- [ ] **Step 3: Final commit (only if gates fixes were needed)**

```bash
git add -A
git commit -m "chore: gates pass for column layout"
```

- [ ] **Step 4: Optional — verify in the running app**

In one terminal: `docker compose up -d && pnpm dev`
In a browser: open a workspace page (`/workspaces/<id>/pages/<id>`), type three paragraphs, drag one onto the right edge of another, observe a 2-column row appearing. Drag a third in. Drag the last out. Reload to confirm YJS persistence.

---

## Open items intentionally deferred

- **Resizable columns** — out of scope; cells stay equal-width
- **Slash command `/columns`** — drag-only creation per spec
- **Block-index in cells used by external scroll-to deep links** — the composite key is now decorated, but the existing scroll-to handler in `apps/web/src/components/page/page-renderer.tsx` (or wherever the deep-link consumer lives) may need a follow-up to accept the dotted form. Audit before shipping deep-link features that need cell granularity.
