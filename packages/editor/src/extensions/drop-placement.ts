import { Extension } from '@tiptap/core'
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
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

function renderIndicatorDecoration(doc: PMNode, state: PluginState): DecorationSet {
  // Decoration via `Decoration.widget` placed at the start of the target node's
  // content. The overlay div is absolutely-positioned via CSS against the
  // target's wrapper, so the bar sits at the inner edge of the target.
  if (!state.zone || !state.target) return DecorationSet.empty
  const target = state.target
  const targetPos = target.kind === 'cell' ? target.cellPos : target.pos
  const overlay = document.createElement('div')
  overlay.className = `column-drop-indicator column-drop-indicator--${state.zone.toLowerCase()}`
  overlay.setAttribute('aria-hidden', 'true')
  return DecorationSet.create(doc, [
    Decoration.widget(targetPos + 1, overlay, {
      side: -1,
      ignoreSelection: true,
      key: `drop-${state.zone}`,
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

            view.dispatch(tr.setMeta(dropPlacementKey, { zone: null, target: null }))
            event.preventDefault()
            return true
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
