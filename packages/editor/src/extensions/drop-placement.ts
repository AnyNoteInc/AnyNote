import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { computeDropZone, type DropZone } from './drop-placement.zones'

// Mirrors `column{1,3}` in column-layout.schema.ts — keep in sync.
const MAX_COLUMNS = 3

type HoverTarget =
  | { kind: 'block'; pos: number; node: PMNode }
  | {
      kind: 'cell'
      cellPos: number
      cellNode: PMNode
      layoutPos: number
      layoutNode: PMNode
    }

type PluginState = { zone: DropZone | null; target: HoverTarget | null }

export const dropPlacementKey = new PluginKey<PluginState>('dropPlacement')

function targetStart(target: HoverTarget): number {
  return target.kind === 'cell' ? target.cellPos : target.pos
}

function targetEnd(target: HoverTarget): number {
  return target.kind === 'cell'
    ? target.cellPos + target.cellNode.nodeSize
    : target.pos + target.node.nodeSize
}

// For TOP/BOTTOM zone on a block: insert before/after the block itself. On a
// cell: insert at the very start/end of the cell's content (cellPos+1 and
// cellPos+nodeSize-1 are inside the open/close tokens).
function computeReorderPos(target: HoverTarget, zone: 'TOP' | 'BOTTOM'): number {
  if (target.kind === 'cell') {
    return zone === 'TOP' ? target.cellPos + 1 : target.cellPos + target.cellNode.nodeSize - 1
  }
  return zone === 'TOP' ? target.pos : target.pos + target.node.nodeSize
}

function resolveHoverTarget($pos: ResolvedPos): HoverTarget | null {
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth)
    if (node.type.name === 'column') {
      const layoutNode = $pos.node(depth - 1)
      const layoutPos = $pos.before(depth - 1)
      const cellPos = $pos.before(depth)
      return { kind: 'cell', cellPos, cellNode: node, layoutPos, layoutNode }
    }
    if (depth === 1) {
      // top-level child of doc
      const pos = $pos.before(depth)
      return { kind: 'block', pos, node }
    }
  }
  return null
}

// Within a columnLayout, find the cell whose horizontal range either contains
// cursorX or is closest to it. Used when posAtCoords lands "between cells" or
// the Y-scan fallback only finds the layout — without this we'd treat the
// whole layout rect as the drop target, and X outside the gap would be
// mis-classified.
function findBestCellInLayout(
  view: EditorView,
  layoutNode: PMNode,
  layoutPos: number,
  cursorX: number,
): HoverTarget | null {
  let cellPos = layoutPos + 1
  let best: HoverTarget | null = null
  let bestDist = Infinity
  for (let j = 0; j < layoutNode.childCount; j++) {
    const cell = layoutNode.child(j)
    const cellDom = view.nodeDOM(cellPos) as HTMLElement | null
    if (cellDom) {
      const cellRect = cellDom.getBoundingClientRect()
      let dist: number
      if (cursorX < cellRect.left) dist = cellRect.left - cursorX
      else if (cursorX > cellRect.right) dist = cursorX - cellRect.right
      else dist = 0
      if (dist < bestDist) {
        bestDist = dist
        best = { kind: 'cell', cellPos, cellNode: cell, layoutPos, layoutNode }
      }
    }
    cellPos += cell.nodeSize
  }
  return best
}

function refineLayoutToCell(
  view: EditorView,
  target: HoverTarget,
  cursorX: number,
): HoverTarget {
  if (target.kind !== 'block' || target.node.type.name !== 'columnLayout') return target
  return findBestCellInLayout(view, target.node, target.pos, cursorX) ?? target
}

// Unified hover-target lookup: tries posAtCoords first (covers cursor over
// real content), then falls back to a Y-scan of top-level children (covers
// cursors in side gutters where posAtCoords lands at depth 0). When the
// matched top-level node is a columnLayout, drill into the closest cell so
// LEFT/RIGHT/TOP/BOTTOM is computed against the cell's bounds, not the
// layout's full width.
function findHoverTarget(view: EditorView, cursorX: number, cursorY: number): HoverTarget | null {
  const pos = view.posAtCoords({ left: cursorX, top: cursorY })
  if (pos) {
    const $pos = view.state.doc.resolve(pos.pos)
    const target = resolveHoverTarget($pos)
    if (target) return refineLayoutToCell(view, target, cursorX)
  }
  const doc = view.state.doc
  let scan = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const dom = view.nodeDOM(scan) as HTMLElement | null
    if (dom) {
      const rect = dom.getBoundingClientRect()
      if (cursorY >= rect.top && cursorY <= rect.bottom) {
        return refineLayoutToCell(view, { kind: 'block', pos: scan, node: child }, cursorX)
      }
    }
    scan += child.nodeSize
  }
  return null
}

function samePlacement(a: PluginState, b: PluginState): boolean {
  if (a.zone !== b.zone) return false
  if (a.target === b.target) return true
  if (!a.target || !b.target) return false
  if (a.target.kind !== b.target.kind) return false
  return targetStart(a.target) === targetStart(b.target)
}

// `dragover` fires ~60Hz so dispatching every event would force PM to rebuild
// the DecorationSet and re-render on each tick even when the placement hasn't
// changed. Compare to the current state and skip the dispatch when identical.
function setPlacement(view: EditorView, next: PluginState): void {
  const current = dropPlacementKey.getState(view.state)
  if (current && samePlacement(current, next)) return
  view.dispatch(view.state.tr.setMeta(dropPlacementKey, next))
}

const CLEARED: PluginState = { zone: null, target: null }

// In-editor drag moves: delete the source range, then insert at `pos`
// re-mapped through the deletion. Otherwise just insert (paste / external
// drop). Returns the (possibly re-assigned) transaction since `delete`
// returns a new tr instance.
function insertContent(
  tr: Transaction,
  pos: number,
  content: PMNode | PMNode['content'],
  source: { from: number; to: number } | null,
): Transaction {
  if (source) {
    const next = tr.delete(source.from, source.to)
    next.insert(next.mapping.map(pos), content)
    return next
  }
  tr.insert(pos, content)
  return tr
}

function replaceContent(
  tr: Transaction,
  from: number,
  to: number,
  content: PMNode | PMNode['content'],
  source: { from: number; to: number } | null,
): Transaction {
  if (source) {
    const next = tr.delete(source.from, source.to)
    next.replaceWith(next.mapping.map(from), next.mapping.map(to), content)
    return next
  }
  tr.replaceWith(from, to, content)
  return tr
}

function renderIndicatorDecoration(doc: PMNode, state: PluginState): DecorationSet {
  // `Decoration.node` adds a class to the target's own DOM node, and a ::before
  // pseudo-element draws the bar. Widget-based decorations are anchored to the
  // insertion point in the DOM tree, which for atom blocks (e.g. images) sits
  // BETWEEN top-level elements with no positioned ancestor — the bar then
  // stretches to the editor's height. The node-class approach keeps the bar
  // inside the target's box so it always matches its height/width.
  if (!state.zone || !state.target) return DecorationSet.empty
  return DecorationSet.create(doc, [
    Decoration.node(targetStart(state.target), targetEnd(state.target), {
      class: `column-drop-target column-drop-target--${state.zone.toLowerCase()}`,
    }),
  ])
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
            return renderIndicatorDecoration(state.doc, dropPlacementKey.getState(state)!)
          },
          handleDrop(view, event, slice, moved) {
            const placement = dropPlacementKey.getState(view.state)
            if (!placement?.zone || !placement.target) return false

            const { zone, target } = placement
            let tr = view.state.tr

            // For in-editor moves, capture the source range *before* we insert anywhere
            // (positions before insertion are stable).
            let source: { from: number; to: number } | null = null
            if (moved && view.dragging?.move) {
              const sel = view.state.selection
              if (!sel.empty) source = { from: sel.from, to: sel.to }
            }

            const schema = view.state.schema
            const columnType = schema.nodes.column
            const layoutType = schema.nodes.columnLayout
            if (!columnType || !layoutType) return false

            // Source-overlaps-target guard: if the dragged range covers the target node
            // we'd delete and re-wrap our own target — produces nonsense. Bail out.
            const tStart = targetStart(target)
            const tEnd = targetEnd(target)
            if (source && source.from <= tStart && tEnd <= source.to) return false

            // If the drag source is itself a column (cell-handle drag), drop its
            // content, not the column wrapper — wrapping a column in another column
            // produces a schema-invalid `column > column > block+` tree that
            // NodeType.create silently allows.
            const sourceFirstChild = slice.content.firstChild
            const droppedContent =
              sourceFirstChild?.type === columnType ? sourceFirstChild.content : slice.content

            if (zone === 'TOP' || zone === 'BOTTOM') {
              const insertPos = computeReorderPos(target, zone)
              tr = insertContent(tr, insertPos, droppedContent, source)
            } else if (target.kind === 'block') {
              // LEFT/RIGHT on a top-level block — wrap it in a new layout.
              const newCell = columnType.create(null, droppedContent)
              const existingCell = columnType.create(null, target.node)
              const cells = zone === 'LEFT' ? [newCell, existingCell] : [existingCell, newCell]
              const layout = layoutType.create(null, cells)
              tr = replaceContent(tr, target.pos, target.pos + target.node.nodeSize, layout, source)
            } else {
              // LEFT/RIGHT on a cell — insert a sibling cell into the layout.
              if (target.layoutNode.childCount >= MAX_COLUMNS) return false
              const newCell = columnType.create(null, droppedContent)
              const cellInsertPos =
                zone === 'LEFT' ? target.cellPos : target.cellPos + target.cellNode.nodeSize
              tr = insertContent(tr, cellInsertPos, newCell, source)
            }

            // Drop sources set a NodeSelection on the dragged row/cell; if we
            // leave it as-is the user sees a stale highlight on the original
            // position. Collapse to a text cursor in the new document state.
            const docSize = tr.doc.content.size
            if (docSize > 0) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.selection.from, docSize))))
            }
            view.dispatch(tr.setMeta(dropPlacementKey, CLEARED))
            event.preventDefault()
            return true
          },
          handleDOMEvents: {
            dragover(view, event) {
              const target = findHoverTarget(view, event.clientX, event.clientY)
              if (!target) {
                setPlacement(view, CLEARED)
                return false
              }
              const dom = view.nodeDOM(targetStart(target)) as HTMLElement | null
              if (!dom) return false
              const canSide =
                target.kind === 'cell' ? target.layoutNode.childCount < MAX_COLUMNS : true
              const zone = computeDropZone(
                { x: event.clientX, y: event.clientY },
                dom.getBoundingClientRect(),
                { canSide },
              )
              setPlacement(view, { zone, target })
              event.preventDefault()
              return true
            },
            dragleave(view, event) {
              // Browsers fire dragleave when crossing into a child element of
              // view.dom (e.g. between cells). Only clear when the cursor has
              // actually left the editor — otherwise the indicator flickers.
              const next = (event as DragEvent).relatedTarget as Node | null
              if (next && view.dom.contains(next)) return false
              setPlacement(view, CLEARED)
              return false
            },
            dragend(view) {
              // Fires when the drag finishes (drop or Escape). Without this,
              // an aborted drag leaves the indicator stuck visible.
              setPlacement(view, CLEARED)
              return false
            },
          },
        },
      }),
    ]
  },
})
