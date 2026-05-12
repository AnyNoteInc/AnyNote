import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { computeDropZone, type DropZone } from './drop-placement.zones'

type HoverTarget =
  | { kind: 'block'; pos: number; node: PMNode }
  | {
      kind: 'cell'
      cellPos: number
      cellNode: PMNode
      layoutPos: number
      layoutNode: PMNode
      cellIndex: number
    }

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
        best = {
          kind: 'cell',
          cellPos,
          cellNode: cell,
          layoutPos,
          layoutNode,
          cellIndex: j,
        }
      }
    }
    cellPos += cell.nodeSize
  }
  return best
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
    const target = resolveHoverTarget(view, $pos)
    if (target?.kind === 'block' && target.node.type.name === 'columnLayout') {
      const refined = findBestCellInLayout(view, target.node, target.pos, cursorX)
      if (refined) return refined
    }
    if (target) return target
  }
  const doc = view.state.doc
  let scan = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const dom = view.nodeDOM(scan) as HTMLElement | null
    if (dom) {
      const rect = dom.getBoundingClientRect()
      if (cursorY >= rect.top && cursorY <= rect.bottom) {
        if (child.type.name === 'columnLayout') {
          const refined = findBestCellInLayout(view, child, scan, cursorX)
          if (refined) return refined
        }
        return { kind: 'block', pos: scan, node: child }
      }
    }
    scan += child.nodeSize
  }
  return null
}

function renderIndicatorDecoration(doc: PMNode, state: PluginState): DecorationSet {
  // `Decoration.node` adds a class to the target's own DOM node, and a ::before
  // pseudo-element draws the bar. Widget-based decorations are anchored to the
  // insertion point in the DOM tree, which for atom blocks (e.g. images) sits
  // BETWEEN top-level elements with no positioned ancestor — the bar then
  // stretches to the editor's height. The node-class approach keeps the bar
  // inside the target's box so it always matches its height/width.
  if (!state.zone || !state.target) return DecorationSet.empty
  const target = state.target
  const start = target.kind === 'cell' ? target.cellPos : target.pos
  const end =
    target.kind === 'cell'
      ? target.cellPos + target.cellNode.nodeSize
      : target.pos + target.node.nodeSize
  return DecorationSet.create(doc, [
    Decoration.node(start, end, {
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

            // Source-overlaps-target guard: if the dragged range covers the target node
            // we'd delete and re-wrap our own target — produces nonsense. Bail out.
            const targetPos = target.kind === 'cell' ? target.cellPos : target.pos
            const targetEnd =
              target.kind === 'cell' ? targetPos + target.cellNode.nodeSize : targetPos + target.node.nodeSize
            if (sourceFrom !== null && sourceTo !== null) {
              if (sourceFrom <= targetPos && targetEnd <= sourceTo) return false
            }

            // If the drag source is itself a column (cell-handle drag), drop its
            // content, not the column wrapper — wrapping a column in another column
            // produces a schema-invalid `column > column > block+` tree that
            // NodeType.create silently allows.
            const sourceFirstChild = slice.content.firstChild
            const sliceIsColumn = sourceFirstChild?.type === columnType
            const droppedContent = sliceIsColumn ? sourceFirstChild.content : slice.content

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
                tr.insert(mapped, droppedContent)
              } else {
                tr.insert(insertPos, droppedContent)
              }
            } else {
              // LEFT or RIGHT — column work
              const newCell = columnType.create(null, droppedContent)

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

            // Drop sources set a NodeSelection on the dragged row/cell; if we
            // leave it as-is the user sees a stale highlight on the original
            // position. Collapse to a text cursor in the new document state.
            const docSize = tr.doc.content.size
            if (docSize > 0) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.selection.from, docSize))))
            }
            view.dispatch(tr.setMeta(dropPlacementKey, { zone: null, target: null }))
            event.preventDefault()
            return true
          },
          handleDOMEvents: {
            dragover(view, event) {
              const target = findHoverTarget(view, event.clientX, event.clientY)
              if (!target) {
                view.dispatch(view.state.tr.setMeta(dropPlacementKey, { zone: null, target: null }))
                return false
              }
              const targetDomPos = target.kind === 'cell' ? target.cellPos : target.pos
              const dom = view.nodeDOM(targetDomPos) as HTMLElement | null
              if (!dom) return false
              const rect = dom.getBoundingClientRect()
              const canSide = target.kind === 'cell' ? target.layoutNode.childCount < 3 : true
              const zone = computeDropZone({ x: event.clientX, y: event.clientY }, rect, {
                canSide,
              })
              view.dispatch(view.state.tr.setMeta(dropPlacementKey, { zone, target }))
              event.preventDefault()
              return true
            },
            dragleave(view, event) {
              // Browsers fire dragleave when crossing into a child element of
              // view.dom (e.g. between cells). Only clear when the cursor has
              // actually left the editor — otherwise the indicator flickers.
              const next = (event as DragEvent).relatedTarget as Node | null
              if (next && view.dom.contains(next)) return false
              view.dispatch(view.state.tr.setMeta(dropPlacementKey, { zone: null, target: null }))
              return false
            },
            dragend(view) {
              // Fires when the drag finishes (drop or Escape). Without this,
              // an aborted drag leaves the indicator stuck visible.
              view.dispatch(view.state.tr.setMeta(dropPlacementKey, { zone: null, target: null }))
              return false
            },
          },
        },
      }),
    ]
  },
})
