import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos, Slice } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { dissolveColumnLayouts, dissolveColumnLayoutsInTransaction } from './column-layout.dissolve'
import { computeDropZone, type DropZone } from './drop-placement.zones'

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

// For TOP/BOTTOM zone on a block: insert before/after the block itself. The
// dragover path bubbles cell targets to their columnLayout first; the cell
// branch is kept defensive for direct state injection in tests/debugging.
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

// Normalize a hover target that lives in (or IS) a columnLayout based on
// cursor X relative to the cells' horizontal bounds:
// - X inside any cell → return that CELL so TOP/BOTTOM can move blocks into a
//   specific column.
// - X in the inter-cell gap or past the layout's left/right edges → return
//   the closest CELL. Those positions are the column-creation gesture; the
//   cell's rect makes computeDropZone return LEFT/RIGHT.
// Targets that aren't part of a columnLayout pass through unchanged.
function resolveLayoutTarget(view: EditorView, target: HoverTarget, cursorX: number): HoverTarget {
  let layoutNode: PMNode
  let layoutPos: number
  if (target.kind === 'cell') {
    layoutNode = target.layoutNode
    layoutPos = target.layoutPos
  } else if (target.node.type.name === 'columnLayout') {
    layoutNode = target.node
    layoutPos = target.pos
  } else {
    return target
  }
  const cells: Array<{ cell: PMNode; cellPos: number; rect: DOMRect }> = []
  let cellPos = layoutPos + 1
  for (let j = 0; j < layoutNode.childCount; j++) {
    const cell = layoutNode.child(j)
    const cellDom = view.nodeDOM(cellPos) as HTMLElement | null
    if (cellDom) {
      const rect = cellDom.getBoundingClientRect()
      if (cursorX >= rect.left && cursorX <= rect.right) {
        return { kind: 'cell', cellPos, cellNode: cell, layoutPos, layoutNode }
      }
      cells.push({ cell, cellPos, rect })
    }
    cellPos += cell.nodeSize
  }
  let best: HoverTarget = { kind: 'block', pos: layoutPos, node: layoutNode }
  let bestDist = Infinity
  for (const c of cells) {
    const dist = cursorX < c.rect.left ? c.rect.left - cursorX : cursorX - c.rect.right
    if (dist < bestDist) {
      bestDist = dist
      best = {
        kind: 'cell',
        cellPos: c.cellPos,
        cellNode: c.cell,
        layoutPos,
        layoutNode,
      }
    }
  }
  return best
}

// Unified hover-target lookup: tries posAtCoords first (covers cursor over
// real content), then falls back to a Y-scan of top-level children (covers
// cursors in side gutters where posAtCoords lands at depth 0). The result
// always passes through resolveLayoutTarget so cell-vs-layout targeting
// matches the cursor's X position relative to the cells.
function findHoverTarget(view: EditorView, cursorX: number, cursorY: number): HoverTarget | null {
  const pos = view.posAtCoords({ left: cursorX, top: cursorY })
  if (pos) {
    const $pos = view.state.doc.resolve(pos.pos)
    const target = resolveHoverTarget($pos)
    if (target) return resolveLayoutTarget(view, target, cursorX)
  }
  const doc = view.state.doc
  let scan = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const dom = view.nodeDOM(scan) as HTMLElement | null
    if (dom) {
      const rect = dom.getBoundingClientRect()
      if (cursorY >= rect.top && cursorY <= rect.bottom) {
        return resolveLayoutTarget(view, { kind: 'block', pos: scan, node: child }, cursorX)
      }
    }
    scan += child.nodeSize
  }
  return null
}

function findVerticalGapPlacement(view: EditorView, cursorY: number): PluginState | null {
  const doc = view.state.doc
  let scan = 0
  let previous: { target: HoverTarget; rect: DOMRect } | null = null

  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const dom = view.nodeDOM(scan) as HTMLElement | null
    const target: HoverTarget = { kind: 'block', pos: scan, node: child }
    scan += child.nodeSize
    if (!dom) continue

    const rect = dom.getBoundingClientRect()
    if (cursorY < rect.top) {
      return { zone: 'TOP', target }
    }
    if (cursorY <= rect.bottom) {
      return null
    }
    previous = { target, rect }
  }

  if (previous && cursorY > previous.rect.bottom) {
    return { zone: 'BOTTOM', target: previous.target }
  }
  return null
}

function computeZoneForTarget(
  view: EditorView,
  target: HoverTarget,
  event: DragEvent,
): DropZone | null {
  const dom = view.nodeDOM(targetStart(target)) as HTMLElement | null
  if (!dom) return null
  return computeDropZone({ x: event.clientX, y: event.clientY }, dom.getBoundingClientRect(), {
    canSide: true,
  })
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

function applyPlacementDrop(
  view: EditorView,
  event: DragEvent,
  slice: Slice,
  moved: boolean,
): boolean {
  const placement = dropPlacementKey.getState(view.state)
  if (!placement?.zone || !placement.target) return false

  const { zone, target } = placement
  let tr = view.state.tr

  // For in-editor moves, capture the source range *before* we insert anywhere
  // (positions before insertion are stable).
  let source: { from: number; to: number } | null = null
  if ((moved || view.dragging) && !view.state.selection.empty) {
    const sel = view.state.selection
    source = { from: sel.from, to: sel.to }
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
    const layout = layoutType.create({ columns: cells.length }, cells)
    tr = replaceContent(tr, target.pos, target.pos + target.node.nodeSize, layout, source)
  } else {
    // LEFT/RIGHT on a cell — insert a sibling cell into the layout.
    const newCell = columnType.create(null, droppedContent)
    const cellInsertPos =
      zone === 'LEFT' ? target.cellPos : target.cellPos + target.cellNode.nodeSize
    tr = insertContent(tr, cellInsertPos, newCell, source)
  }

  // Drop sources set a NodeSelection on the dragged row/cell; if we
  // leave it as-is the user sees a stale highlight on the original
  // position. Collapse to a text cursor in the new document state.
  dissolveColumnLayoutsInTransaction(tr)
  const docSize = tr.doc.content.size
  if (docSize > 0) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.selection.from, docSize))))
  }
  view.dispatch(tr.setMeta(dropPlacementKey, CLEARED))
  const cleanup = dissolveColumnLayouts(view.state)
  if (cleanup) {
    view.dispatch(cleanup.setMeta(dropPlacementKey, CLEARED))
  }
  event.preventDefault()
  return true
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
        view(editorView) {
          const withinEditorX = (event: DragEvent): boolean => {
            const rect = editorView.dom.getBoundingClientRect()
            return event.clientX >= rect.left && event.clientX <= rect.right
          }

          const handleDocumentDragOver = (event: DragEvent) => {
            if (!editorView.dragging || !withinEditorX(event)) return
            const gapPlacement = findVerticalGapPlacement(editorView, event.clientY)
            if (!gapPlacement) return
            setPlacement(editorView, gapPlacement)
            event.preventDefault()
          }

          const handleDocumentDrop = (event: DragEvent) => {
            const targetNode = event.target instanceof Node ? event.target : null
            if (!editorView.dragging || (targetNode && editorView.dom.contains(targetNode))) return
            const dragging = editorView.dragging
            if (!dragging || !withinEditorX(event)) return
            const gapPlacement = findVerticalGapPlacement(editorView, event.clientY)
            if (gapPlacement) setPlacement(editorView, gapPlacement)
            applyPlacementDrop(editorView, event, dragging.slice, dragging.move)
          }

          document.addEventListener('dragover', handleDocumentDragOver, true)
          document.addEventListener('drop', handleDocumentDrop, true)
          return {
            destroy() {
              document.removeEventListener('dragover', handleDocumentDragOver, true)
              document.removeEventListener('drop', handleDocumentDrop, true)
            },
          }
        },
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
            return applyPlacementDrop(view, event, slice, moved)
          },
          handleDOMEvents: {
            dragover(view, event) {
              const target = findHoverTarget(view, event.clientX, event.clientY)
              if (!target) {
                const gapPlacement = findVerticalGapPlacement(view, event.clientY)
                if (!gapPlacement) {
                  setPlacement(view, CLEARED)
                  return false
                }
                setPlacement(view, gapPlacement)
                event.preventDefault()
                return true
              }
              const zone = computeZoneForTarget(view, target, event)
              if (!zone) {
                const gapPlacement = findVerticalGapPlacement(view, event.clientY)
                if (!gapPlacement) {
                  setPlacement(view, CLEARED)
                  return false
                }
                setPlacement(view, gapPlacement)
                event.preventDefault()
                return true
              }
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
