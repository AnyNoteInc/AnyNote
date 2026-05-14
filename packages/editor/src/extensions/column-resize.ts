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
    for (let i = 0; i < node.childCount - 1; i++) {
      const cell = node.child(i)
      const rightIndex = i + 1
      decorations.push(
        Decoration.widget(
          cellPos + cell.nodeSize - 1,
          () => {
            const el = document.createElement('div')
            el.className = 'column-divider'
            el.contentEditable = 'false'
            el.dataset.layoutPos = String(pos)
            el.dataset.rightIndex = String(rightIndex)
            return el
          },
          { side: 1, key: `column-divider:${pos}:${rightIndex}` },
        ),
      )
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
  if (layout?.type.name !== 'columnLayout') return
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
  if (layout?.type.name !== 'columnLayout') return null
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

// Only one divider can be dragged at a time per page, so the active cleanup
// lives module-locally. The plugin's `view().destroy()` reads this so an
// editor unmount mid-drag still tears down document listeners and the
// `is-dragging` class.
let activeCleanup: (() => void) | null = null

export const columnResizePlugin = new Plugin({
  key: columnResizeKey,
  view() {
    return {
      destroy() {
        activeCleanup?.()
      },
    }
  },
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

        // Coalesce mousemove dispatches to one per animation frame. Raw
        // mousemove can fire faster than the display refresh rate, and each
        // dispatch reshapes the doc + (in collab) emits a Yjs update — so
        // throttling here cuts churn down to the display rate.
        let latestClientX = event.clientX
        let rafId: number | null = null

        const cleanup = () => {
          if (rafId !== null) {
            cancelAnimationFrame(rafId)
            rafId = null
          }
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          document.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('blur', onBlur)
          drag.dividerEl.classList.remove('is-dragging')
          activeCleanup = null
        }

        const dispatchForX = (clientX: number, addToHistory: boolean) => {
          const deltaPx = clientX - drag.startX
          const deltaFraction = deltaPx / drag.pixelsPerShare
          const { left, right } = computeResizedWidths(
            drag.initialLeft,
            drag.initialRight,
            deltaFraction,
            MIN_WIDTH_FRACTION,
          )
          dispatchWidths(view, drag.layoutPos, drag.rightIndex, left, right, addToHistory)
        }

        const onMove = (moveEvent: MouseEvent) => {
          latestClientX = moveEvent.clientX
          if (rafId !== null) return
          rafId = requestAnimationFrame(() => {
            rafId = null
            dispatchForX(latestClientX, false)
          })
        }
        const onUp = (upEvent: MouseEvent) => {
          dispatchForX(upEvent.clientX, true)
          cleanup()
        }
        const onKeyDown = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key !== 'Escape') return
          dispatchWidths(
            view,
            drag.layoutPos,
            drag.rightIndex,
            drag.initialLeft,
            drag.initialRight,
            true,
          )
          cleanup()
        }
        const onBlur = () => {
          dispatchWidths(
            view,
            drag.layoutPos,
            drag.rightIndex,
            drag.initialLeft,
            drag.initialRight,
            true,
          )
          cleanup()
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        document.addEventListener('keydown', onKeyDown)
        window.addEventListener('blur', onBlur)
        activeCleanup = cleanup

        event.preventDefault()
        return true
      },
    },
  },
})
