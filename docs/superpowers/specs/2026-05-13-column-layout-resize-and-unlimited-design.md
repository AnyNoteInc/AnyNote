# Column layout: unlimited columns + resizable dividers

Status: draft (2026-05-13)
Branch: `feat/tiptap-column-layout`
Builds on: [2026-05-12-tiptap-column-layout-design.md](./2026-05-12-tiptap-column-layout-design.md)

## Goal

Three changes to the existing column layout in the Tiptap editor:

1. Drop the 3-column cap. The user can build rows with any number of columns by dragging blocks past the right (or left) edge of a layout.
2. Add a draggable divider in the gap between adjacent columns. Hovering reveals a thin vertical line; dragging redistributes width between the two neighboring columns.
3. Hide the drag-handle controls (the `+` and `⋮⋮` buttons) for `columnLayout` and `column` nodes themselves — only content blocks inside a column keep them.

## Non-goals

- No row drag/duplicate/delete via UI handle for the layout itself. Removing a row stays implicit: empty out all cells and dissolve cleans up.
- No per-column min-width override per node. One global `MIN_WIDTH_FRACTION = 0.1` keeps neighbors usable.
- No mobile resize. Below 600px width the layout already collapses to a vertical stack; dividers are hidden there.
- No persistence of gap size — `gap: 24px` stays fixed.

## Architecture overview

The existing column layout uses a ProseMirror schema (`columnLayout { content: 'column{1,3}' }`) plus a drop-placement plugin that handles dragging blocks into/out of cells. Width was fixed: CSS Grid with `1fr` per column.

This change replaces the rigid 3-column count with `column+` and switches the layout from CSS Grid to flexbox. Each `column` carries a `width` attribute (a unitless flex share, default 1). Columns render with inline `style="--column-width: <width>"`; the layout's CSS reads `flex: var(--column-width, 1) 1 0` so each column claims its share of the available space.

A new ProseMirror plugin (`column-resize.ts`) emits widget decorations for divider hit-zones in every gap between adjacent columns. Mousedown on a divider drags it: live transactions (marked `addToHistory: false`) move width from one side to the other; mouseup commits one historied transaction with the final widths.

The drag-handle library is told via a new `DragHandleRule` to never pick `columnLayout` or `column` as a target. Content inside cells still gets the handle.

## File-by-file changes

### `packages/editor/src/extensions/column-layout.schema.ts`

- `columnLayoutSpec.content`: `'column{1,3}'` → `'column+'`.
- `ColumnLayoutSchema.content`: same.
- `columnLayoutSpec.attrs.columns` and `ColumnLayoutSchema.addAttributes().columns` stay (used in `data-columns` for SSR/inspection). It tracks `childCount` and stops being a constraint.
- `columnSpec` gains a `width` attribute via `attrs: { width: { default: 1 } }`. ParseDOM reads `data-width`; toDOM emits `data-width` + `style: \`--column-width: ${width}\``.
- `ColumnSchema.addAttributes` mirrors this: `width` default 1, parseHTML from `data-width`, renderHTML emits both attributes.
- Class names emitted by `toDOM`/`renderHTML` drop the `column-layout--N` modifier (the count-specific grid templates are gone). The base `column-layout` class stays.

### `packages/editor/src/extensions/column-resize.ts` (new)

ProseMirror Plugin. Exports `columnResizePlugin: Plugin` and a pure helper `computeResizedWidths(left, right, deltaFraction, minFraction)`.

`computeResizedWidths(left, right, deltaFraction, minFraction)`:
- Returns `{ left: newLeft, right: newRight }` such that `newLeft + newRight === left + right`.
- Computes `proposedLeft = left + deltaFraction`, `proposedRight = right - deltaFraction`.
- Clamps each to `[(left + right) * minFraction, (left + right) * (1 - minFraction)]`.
- Pure, tested standalone.

Plugin behavior:

- `state`: no internal state. Decorations recomputed each `decorations(state)` call.
- `props.decorations(state)`: walks the doc; for each `columnLayout` with `childCount >= 2`, emits one `Decoration.widget` for each cell index `i ∈ [1, childCount-1]` at that cell's start position (inside the layout, just past the cell's opening token). Widget renders `<div class="column-divider" contenteditable="false" data-layout-pos="<layoutPos>" data-right-index="<i>">`. Uses `side: -1` so the widget sits at the very start of cell `i` (i.e. visually in the gap between cell `i-1` and cell `i`), and never collides with other widgets that might sit at the same position.
- `props.handleDOMEvents.mousedown`: filters `event.target instanceof HTMLElement && target.classList.contains('column-divider')`. On match:
  - Reads `layoutPos = Number(target.dataset.layoutPos)` and `rightIndex = Number(target.dataset.rightIndex)`.
  - Resolves the layout: `layout = state.doc.nodeAt(layoutPos)`. Computes cell positions by walking children: starting from `layoutPos + 1`, accumulate `child.nodeSize` to find `leftCellPos` (position of `layout.child(rightIndex - 1)`) and `rightCellPos` (position of `layout.child(rightIndex)`). These positions are stable until the next dispatched transaction — we recompute them inside `mousemove` after each dispatch by re-reading from `view.state.doc.nodeAt(layoutPos)`.
  - Reads `leftCell` and `rightCell` nodes and their `width` attrs.
  - Reads pixel widths via `view.nodeDOM(leftCellPos).getBoundingClientRect()` and same for right.
  - Computes `pixelsPerShare = (leftPx + rightPx) / (leftWidth + rightWidth)`.
  - Stores `startX = event.clientX`, the two initial widths, `pixelsPerShare`, `layoutPos`, `rightIndex`.
  - Adds class `is-dragging` to the divider element.
  - Attaches `mousemove`/`mouseup` listeners to `document`.
  - `event.preventDefault()` and returns `true` (consume).
- `mousemove`:
  - `deltaPx = e.clientX - startX`.
  - `deltaFraction = deltaPx / pixelsPerShare`.
  - `{ left, right } = computeResizedWidths(initialLeft, initialRight, deltaFraction, MIN_WIDTH_FRACTION)`.
  - Resolve current cell positions from `view.state.doc.nodeAt(layoutPos)` (positions are stable across same-shape transactions, but re-reading is safer than caching). Dispatch a single transaction with two `setNodeMarkup(pos, null, { width })` calls (left then right), then `tr.setMeta('addToHistory', false)`.
- `mouseup`:
  - Compute one final pair the same way.
  - Dispatch as a normal historied transaction (no `addToHistory` meta).
  - Remove `is-dragging` class.
  - Remove the document listeners.

`MIN_WIDTH_FRACTION = 0.1` — a constant module-local.

### `packages/editor/src/extensions/column-layout.ts`

- Imports `columnResizePlugin` and adds it to the array returned from `addProseMirrorPlugins`.

### `packages/editor/src/extensions/drop-placement.ts`

- Remove `const MAX_COLUMNS = 3` and the keep-in-sync comment.
- `computeZoneForTarget`: `canSide` is unconditionally `true`. Drop the `target.layoutNode.childCount < MAX_COLUMNS` check.
- `applyPlacementDrop`, cell-side branch: drop the `if (target.layoutNode.childCount >= MAX_COLUMNS) return false`. The new cell is created with the default `width: 1` (no explicit attr — schema default kicks in).
- `applyPlacementDrop`, block-side branch (creating a fresh 2-cell layout from a top-level block): no change — each new cell is `columnType.create(null, content)` which uses default `width: 1`.

### `packages/editor/src/components/drag-handle.tsx`

- Add a new rule:
  ```ts
  const excludeColumnNodes: DragHandleRule = {
    id: 'excludeColumnNodes',
    evaluate: ({ node }) => {
      if (node.type.name === 'columnLayout' || node.type.name === 'column') return 10000
      return 0
    },
  }
  ```
- Add it to `nestedOptions.rules` alongside `firstChildOfContainer`.
- Strip cell/row context from `HoverNodePos` and `onNodeChange`: remove `kind`, `rowFrom`, `rowTo`, `cellFrom`, `cellTo` fields. `onNodeChange` becomes a plain `node`→`{from, to, isEmpty}` mapping.
- Remove the `context` prop forwarded to `DragHandleMenu`.

### `packages/editor/src/components/drag-handle-menu.tsx`

- Remove the `context` prop and its `kind: 'cell'` branches: `handleDeleteRow`, `handleDeleteCell`, `handleUnwrapCell`, and their three menu items.
- Remove cell-related imports if any become unused.

### `packages/editor/src/styles/content.css`

Replace the existing column-layout block (currently `display: grid; grid-template-columns: 1fr [1fr [1fr]]`) with:

```css
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

@media (max-width: 600px) {
  .anynote-editor .column-layout {
    flex-direction: column;
  }
  .anynote-editor .column-divider {
    display: none;
  }
}
```

The existing `.column-drop-target--{left,right,top,bottom}` rules and the position-relative ProseMirror children rules stay untouched.

### `packages/editor/src/styles/content.test.ts`

Update assertions that match `.column-layout--1/2/3` and `grid-template-columns` patterns to match the new flexbox layout (e.g. assert `display: flex` on `.column-layout` and `flex: var(--column-width, 1) 1 0` on `.column`). Remove asserts on `--1/2/3` modifiers.

### `packages/editor/src/extensions/column-layout.schema.test.ts`

- Update the "creates layout with 1-3 cells" test to also cover 4 cells (sanity check that `column+` allows it). Keep the 0-cells failure assertion.
- Add an assertion that the `width` default is 1.

### `packages/editor/src/extensions/column-layout.dissolve.test.ts`

- Add a regression case: a 4-cell layout with one empty cell → dissolve removes the empty cell, leaves a 3-cell layout. Verifies the existing logic generalizes beyond 3.

### `packages/editor/src/extensions/column-resize.test.ts` (new)

Vitest unit suite for the pure helper `computeResizedWidths`:
- delta=0 returns inputs unchanged.
- positive delta moves share from right to left, keeping the sum.
- negative delta moves share from left to right, keeping the sum.
- clamps when proposed left < (sum * minFraction).
- clamps when proposed right < (sum * minFraction).
- works with non-equal starting widths (e.g. 2 and 1).

### `apps/e2e/page-columns.spec.ts`

Add the five Playwright tests described in section 5 of the design. Rename `'dragging content out of a 3-column row removes the emptied column'` to `'dragging content out of a multi-column row removes the emptied column'`.

## Data model & migration

`column.width` is a new attribute with a `default: 1`. Existing documents stored in Yjs have no `width` attribute on their column nodes; ProseMirror's schema validation will assign the default on read. No migration needed.

If we ever export/import via Markdown the width is lost (already true for the column layout itself, which markdown doesn't represent). Out of scope here.

## Error & edge cases

- **1-cell layout transient state**: dissolve plugin already raises 1-cell layouts back to plain blocks via `appendTransaction`. The resize plugin only emits dividers when `childCount >= 2`, so no divider ever shows on a 1-cell layout (which only exists for one frame anyway).
- **Cell DOM not found during mousedown**: if `view.nodeDOM(cellPos)` returns null (rare, mid-render), abort the drag silently (don't attach listeners).
- **Drag interrupted by Escape or focus loss**: the mouseup listener fires regardless of where the cursor went, so the divider always finalizes. If `mouseup` never fires (e.g. tab-switch), we leak listeners until the next `mousedown` — acceptable since the count is bounded by user gestures. The plugin's `destroy()` removes any active listeners.
- **Concurrent edits via Yjs**: each `setNodeMarkup` is a normal transaction; multiple users dragging the same divider at once will produce competing final widths. Last-write-wins is fine for this UX.
- **Adding a 4th+ column via drag**: `applyPlacementDrop`'s cell-LEFT/RIGHT branch already inserts a new cell with `columnType.create(null, droppedContent)`. No `width` override means the schema default 1 applies. Existing siblings keep their widths, so the new cell claims one share of the total — visually, the new column is the same width as a default column would be next to a 2-share neighbor.

## Test strategy

- Unit (vitest, packages/editor):
  - `column-resize.test.ts` for `computeResizedWidths`.
  - `column-layout.schema.test.ts` extended to 4+ cells and width default.
  - `column-layout.dissolve.test.ts` extended for 4-cell case.
  - `content.test.ts` rewritten for flexbox.
- E2E (Playwright, apps/e2e/page-columns.spec.ts): 4-column creation, divider resize, clamp, drag-handle visibility, menu items absent.

`pnpm gates` must pass before merge: check-types + lint + build + test.

## Open questions

None at draft time.
