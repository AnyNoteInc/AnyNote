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
