# Tiptap Column Layout — Design

Drag-and-drop column layout for the AnyNote Tiptap editor. Users can split a
row into 2 or 3 columns by dragging a block onto the left or right edge of
another block; existing vertical drag-and-drop is preserved.

## Goals

- Build horizontal layouts (up to 3 cells per row) without leaving the document
- Discoverable: works through drag, the only mode any block currently has
- Preserve all existing vertical drag/drop behavior unchanged
- Round-trips through YJS-collab and server-side export without divergence

## Non-goals

- Resizable columns (cells are equal width; resize is a follow-up)
- Slash command `/columns` for empty rows (drag-only creation)
- Nested column layouts (rows live top-level only)
- Columns inside containers (`callout` / `toggle` / `hiddenText`)

## User-visible behavior

### Drop zones over a hover target

Cursor position over the target's bounding rect determines what happens on drop:

| Zone | Width / height | Action |
|---|---|---|
| LEFT | x ∈ [rect.left, rect.left + 0.25·w) | New column inserted at left of target's row, or wrap target+source into a new row if target is plain top-level |
| RIGHT | x ∈ (rect.right − 0.25·w, rect.right] | Same as LEFT but on the right side |
| TOP | otherwise; y ∈ [rect.top, rect.top + h/2) | Insert above target — vertical drop, semantically the same as today's `dropcursor` |
| BOTTOM | otherwise; y ∈ [rect.top + h/2, rect.bottom] | Insert below target — vertical drop |

The TOP/BOTTOM action is rebuilt in our plugin (not delegated to the disabled
`dropcursor`), but it produces the same document mutation a plain block drop
would today.

If the target is a `column` cell within a 3-cell row, LEFT and RIGHT zones are
disabled — no indicator appears, drop in those zones is a no-op.

LEFT vs RIGHT insertion index is relative to the *target cell's* position
inside its row: dropping on the LEFT of the middle cell in a 2-cell row makes
the new column index 1 (between the two existing); dropping on the RIGHT makes
it index 2 (rightmost).

### Drop indicators

- **LEFT / RIGHT** — 3px vertical bar, MUI `primary.main` (`#1976d2`), at the
  inner edge of the target node (Notion-style, thin)
- **TOP / BOTTOM** — horizontal line of the same color across the target's
  width, between blocks

Both are ProseMirror `Decoration` widgets attached by a single plugin. The
default `dropcursor` extension from `StarterKit` is disabled.

### Row controls

Two distinct drag handles:

- **Row handle** — `⠿` and `+` in the left 48px gutter of the page (same
  position as the current single-block handle). Drags the entire row.
- **Cell handle** — a smaller `⠿` at top-left inside each cell, visible on
  hover only. Drags one column out of the row.

The block menu under each handle adapts:

- Row menu: "Move row", "Delete row"
- Cell menu: "Move cell", "Delete cell", "Unwrap cell to blocks"
- Plain block menu (unchanged): "Move block", "Delete block"

### Auto-dissolution

After every transaction, `columnLayout` nodes are normalized:

- 0 non-empty columns → entire layout removed
- 1 non-empty column → unwrap; the column's children replace the layout at its
  position in the parent
- Empty columns inside a 2- or 3-cell row → removed (no placeholder cells)

This is implemented as `appendTransaction` so it runs on local edits, remote
YJS updates, and undo/redo identically.

### Width and gap

Cells share width equally via CSS Grid: `repeat(N, 1fr)` with `gap: 24px`. The
gap is intentionally generous so each cell's internal `⠿` handle and the
ProseMirror caret have visual breathing room.

### Responsive

`@media (max-width: 600px)` collapses any `.column-layout` to
`grid-template-columns: 1fr`, stacking cells vertically. No JS reflow needed.

## Architecture

### Schema (new nodes)

```
columnLayout
  group: "block"
  content: "column{1,3}"
  attrs: { columnCount: 1 | 2 | 3 }   // derived, used for CSS class
  toDOM: <div class="column-layout" data-columns="N">
  defining: true

column
  content: "block+"
  isolating: true                     // selection contained within cell
  toDOM: <div class="column">
```

Top-level node spec stays `(columnLayout | block)+`. Containers
(`callout`, `toggle`, `hiddenText`) keep their existing `content: "block+"`
restriction — schema disallows `columnLayout` inside.

### Files

**New:**

- [packages/editor/src/extensions/column-layout.ts](packages/editor/src/extensions/column-layout.ts) — Tiptap extension declaring both nodes, commands (`splitIntoColumns`, `insertColumn`, `dissolveColumn`, `unwrapCell`), `appendTransaction` for auto-dissolution
- [packages/editor/src/extensions/drop-placement.ts](packages/editor/src/extensions/drop-placement.ts) — ProseMirror plugin: zone detection, decoration rendering, drop transaction builder; replaces the default `dropcursor`
- [packages/editor/src/extensions/drop-placement.test.ts](packages/editor/src/extensions/drop-placement.test.ts) — Vitest unit tests on zone math and transaction shape
- [packages/editor/src/extensions/column-layout.test.ts](packages/editor/src/extensions/column-layout.test.ts) — Vitest unit tests on schema and auto-dissolution
- [apps/e2e/page-columns.spec.ts](apps/e2e/page-columns.spec.ts) — Playwright e2e flow

**Modified:**

- [packages/editor/src/extensions/index.ts](packages/editor/src/extensions/index.ts) — `StarterKit.configure({ undoRedo: false, dropcursor: false })`, register `ColumnLayout` and `DropPlacement`
- [packages/editor/src/components/drag-handle.tsx](packages/editor/src/components/drag-handle.tsx) — `onNodeChange` resolves whether the hovered position is inside a `column` (cell) or under `columnLayout` (row); render distinguishes between row handle (gutter) and cell handle (inside cell)
- [packages/editor/src/components/drag-handle-menu.tsx](packages/editor/src/components/drag-handle-menu.tsx) — Conditional menu items based on target kind (row / cell / plain block)
- [packages/editor/src/styles/content.css](packages/editor/src/styles/content.css) — `.column-layout`, `.column`, drop-indicator classes, responsive media query
- [packages/editor/src/extensions/block-index-attributes.ts](packages/editor/src/extensions/block-index-attributes.ts) — Account for cell-nested blocks when computing scroll-to-block indices (composite key `row[i].cell[j].block[k]`)
- [packages/editor/src/server.ts](packages/editor/src/server.ts) — Register new nodes in server-side schema for export / `PageRenderer`

### Drop flow

```
dragover event
  │
  ├─ pos = view.posAtCoords({left, top})
  ├─ resolve pos → { target, kind: 'block' | 'cell' | 'row-cell' }
  ├─ rect = view.nodeDOM(targetPos).getBoundingClientRect()
  ├─ compute zone from (x, y, rect)
  ├─ if zone is LEFT|RIGHT and targetCellRow.columnCount === 3 → zone = null
  └─ update Decoration → indicator at edge or between blocks

drop event
  │
  ├─ source = view.dragging.slice
  ├─ srcPos = view.dragging.move ? deleted source range
  ├─ build tr based on zone × target.kind:
  │    TOP/BOTTOM, block        → standard insert before/after
  │    TOP/BOTTOM, cell         → insert inside cell, before/after target block
  │    LEFT/RIGHT, block        → wrap target and source in new columnLayout
  │    LEFT/RIGHT, cell, < 3    → insert new column at cellIndex or cellIndex+1
  │    LEFT/RIGHT, cell, 3      → no-op (zone already gated)
  └─ dispatch tr (auto-dissolution runs in appendTransaction after)
```

Source position is captured from the existing `EditorDragHandle` via
`view.dragging`. We don't change how drags *start*; only how drops resolve.

### Auto-dissolution algorithm

In `appendTransaction(transactions, oldState, newState)`:

```
for each columnLayout node in newState.doc:
  count non-empty columns
  if count === 0:
    delete the entire columnLayout
  else if count === 1:
    replace columnLayout with its single column's children
  else:
    remove any empty columns, then update columnCount attr
```

The transaction is appended in a single step so undo collapses correctly.

## Edge cases

| Case | Behavior |
|---|---|
| Drag cell-handle to top/bottom of an outside block | Cell becomes a top-level node; source row dissolves if 1 column remains |
| Drag row-handle to top/bottom of another block | Entire row moves as one unit |
| Drag cell within its own row | Swap positions (still 2 or 3 columns) |
| Drag onto empty cell (no children) | TOP/BOTTOM treated as "insert as first child"; LEFT/RIGHT still create new column |
| Undo/redo | Single drop = single transaction including auto-dissolve; one undo step |
| YJS concurrent edits | `appendTransaction` is deterministic over `doc`, converges after rebase |
| Server-side export | New nodes registered in `server.ts` schema; HTML output uses same `.column-layout` markup |
| PageRenderer (read-only) | Reuses `@repo/editor` runtime, inherits column rendering |
| Selection across cell boundaries | Blocked by `isolating: true` on `column` — same as table cells |
| Existing documents without columns | Schema permits old content unchanged; no migration |

## Testing

**Unit (Vitest in `packages/editor`):**

- Editor package has no vitest config yet — add one (mirroring `apps/web/vitest.config.ts`). One-time cost.
- `drop-placement.test.ts`: zone calculation for representative (cursor, rect) pairs; gating for max-3 row; resolve helper for `block` vs `cell` vs `row-cell` targets
- `column-layout.test.ts`: schema accepts valid trees, rejects invalid (column outside layout, layout inside callout); `appendTransaction` produces expected document for each dissolution case

**E2E (`apps/e2e/page-columns.spec.ts`, runs against Playwright dev server):**

- Drag paragraph B onto right edge of A → row of 2 (assert grid template, assert order)
- Drag third paragraph onto right edge → row of 3
- Drag fourth onto edge of full row → no indicator on side zones, drops above/below
- Drag second cell out of row to top of outside block → row dissolves, both blocks become top-level
- Vertical drag of two plain blocks (no columns) — current behavior unchanged
- Reload page after creating columns → YJS persistence preserves layout
- Open same page in read-only `PageRenderer` view → columns render

**Gates:** `pnpm gates` (check-types + lint + build + test) before any PR.

## Visual reference

Indicator color: `theme.palette.primary.main` (currently `#1976d2`).
Indicator thickness: 3px (vertical) / 2px (horizontal — matches existing
ProseMirror dropcursor scale).
Cell gap: 24px.
Cell width: pure `1fr` shares — no minimum width enforced. Cells can shrink
below paragraph readability when the page is narrow; the `(max-width: 600px)`
media query collapses to a single column before that becomes a problem.

## Open items deferred to implementation plan

- Whether to expose `columnCount` as a node attr or derive it from children at
  render time (attr is simpler for CSS, but needs sync with children)
- Exact composite key format for `BlockIndexAttributes` in cell-nested blocks
- Vitest config setup for `packages/editor` (no test runner currently)
