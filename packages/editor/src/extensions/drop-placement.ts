import { Extension } from '@tiptap/core'
import {
  Fragment,
  type Node as PMNode,
  type NodeType,
  type ResolvedPos,
  type Slice,
} from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
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

function getDragNodeRange(
  dragging: EditorView['dragging'],
): { from: number; to: number } | null {
  if (!dragging || !('node' in dragging)) return null
  const node = (dragging as { node?: { from: number; to: number } }).node
  return node ? { from: node.from, to: node.to } : null
}

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

function isFirstChildOfListItem($pos: ResolvedPos, depth: number): boolean {
  if (depth <= 1) return false
  const parent = $pos.node(depth - 1)
  return (
    $pos.index(depth - 1) === 0 &&
    (parent.type.name === 'listItem' || parent.type.name === 'taskItem')
  )
}

function isListItemFirstChild(parent: PMNode, index: number): boolean {
  return index === 0 && (parent.type.name === 'listItem' || parent.type.name === 'taskItem')
}

function canTargetBlock(node: PMNode): boolean {
  return node.isBlock && node.type.name !== 'columnLayout' && node.type.name !== 'column'
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
    if (
      depth > 0 &&
      canTargetBlock(node) &&
      !isFirstChildOfListItem($pos, depth)
    ) {
      const pos = $pos.before(depth)
      return { kind: 'block', pos, node }
    }
  }
  return null
}

function childHoverTarget(
  parent: Extract<HoverTarget, { kind: 'block' }>,
  index: number,
): HoverTarget | null {
  const child = parent.node.child(index)
  if (isListItemFirstChild(parent.node, index)) return null
  if (!canTargetBlock(child)) return null
  let pos = parent.pos + 1
  for (let i = 0; i < index; i++) {
    pos += parent.node.child(i).nodeSize
  }
  return { kind: 'block', pos, node: child }
}

function findNestedBlockTargetByY(
  view: EditorView,
  parent: Extract<HoverTarget, { kind: 'block' }>,
  cursorY: number,
): HoverTarget | null {
  let previous: { target: HoverTarget; rect: DOMRect } | null = null

  for (let i = 0; i < parent.node.childCount; i++) {
    const childTarget = childHoverTarget(parent, i)
    if (!childTarget) continue
    const dom = view.nodeDOM(targetStart(childTarget)) as HTMLElement | null
    if (!dom) continue

    const rect = dom.getBoundingClientRect()
    if (cursorY < rect.top) return childTarget
    if (cursorY <= rect.bottom) {
      if (childTarget.kind === 'block') {
        return findNestedBlockTargetByY(view, childTarget, cursorY) ?? childTarget
      }
      return childTarget
    }
    previous = { target: childTarget, rect }
  }

  return previous?.target ?? null
}

function refineNestedBlockTarget(
  view: EditorView,
  target: HoverTarget,
  cursorY: number,
): HoverTarget {
  if (target.kind !== 'block') return target
  return findNestedBlockTargetByY(view, target, cursorY) ?? target
}

function nearestTextSelection(doc: PMNode, pos: number): Selection {
  const clamped = Math.max(0, Math.min(pos, doc.content.size))
  let nearestPos: number | null = null
  let nearestDistance = Infinity

  doc.descendants((node, nodePos) => {
    if (!node.isTextblock) return true
    const from = nodePos + 1
    const to = nodePos + node.content.size
    const cursor = Math.max(from, Math.min(to, clamped))
    const distance = clamped < from ? from - clamped : Math.max(0, clamped - to)
    if (distance < nearestDistance) {
      nearestPos = cursor
      nearestDistance = distance
    }
    return true
  })

  if (nearestPos !== null) return TextSelection.create(doc, nearestPos)
  return Selection.near(doc.resolve(clamped))
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
    if (target) {
      return resolveLayoutTarget(view, refineNestedBlockTarget(view, target, cursorY), cursorX)
    }
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
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList'])

function expandSourceRangeToDraggedNode(
  view: EditorView,
  source: { from: number; to: number },
  content: Fragment,
): { from: number; to: number } {
  const draggedNode = content.firstChild
  if (!draggedNode) return source
  const $from = view.state.doc.resolve(Math.min(source.from + 1, view.state.doc.content.size))
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type !== draggedNode.type) continue
    const from = $from.before(depth)
    const to = from + node.nodeSize
    if (source.from >= from && source.to <= to) return { from, to }
  }
  return source
}

function expandSingleListItemSource(
  view: EditorView,
  source: { from: number; to: number },
): { from: number; to: number } {
  const $from = view.state.doc.resolve(Math.min(source.from + 1, view.state.doc.content.size))
  for (let depth = $from.depth; depth > 1; depth--) {
    const node = $from.node(depth)
    const from = $from.before(depth)
    const to = from + node.nodeSize
    if (from !== source.from || to !== source.to) continue
    const parent = $from.node(depth - 1)
    if (parent.childCount !== 1 || !LIST_TYPES.has(parent.type.name)) return source
    const parentFrom = $from.before(depth - 1)
    return { from: parentFrom, to: parentFrom + parent.nodeSize }
  }
  return source
}

function dragSourceRange(view: EditorView, content: Fragment): { from: number; to: number } | null {
  const nodeRange = getDragNodeRange(view.dragging)
  if (nodeRange) {
    return expandSingleListItemSource(view, nodeRange)
  }
  const { selection } = view.state
  if (selection.empty) return null
  const source = expandSourceRangeToDraggedNode(
    view,
    { from: selection.from, to: selection.to },
    content,
  )
  return expandSingleListItemSource(view, source)
}

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

// Wrap a fragment so it satisfies `parentType`'s content rule. If the fragment
// already fits, returns it unchanged; otherwise climbs the schema via
// `findWrapping` (e.g. taskItem → taskList). Returns null if no wrapping path
// exists.
function wrapForContent(content: Fragment, parentType: NodeType): Fragment | null {
  if (parentType.contentMatch.matchFragment(content)) return content
  const firstChild = content.firstChild
  if (!firstChild) return null
  const wrapping = parentType.contentMatch.findWrapping(firstChild.type)
  if (!wrapping || wrapping.length === 0) return null
  let result = content
  for (let i = wrapping.length - 1; i >= 0; i--) {
    const wrapType = wrapping[i]
    if (!wrapType) return null
    const wrapped = wrapType.createAndFill(null, result)
    if (!wrapped) return null
    result = Fragment.from(wrapped)
  }
  return result
}

function buildBlockTargetTransaction(
  view: EditorView,
  zone: DropZone,
  target: Extract<HoverTarget, { kind: 'block' }>,
  source: { from: number; to: number } | null,
  droppedFitted: Fragment,
  columnType: NodeType,
  layoutType: NodeType,
): Transaction | null {
  const tr = view.state.tr
  // If the source lives inside target.node, the captured reference is stale
  // (still contains the source). Delete first and re-read from the
  // post-deletion doc so we don't duplicate the source across both columns.
  const sourceInsideTarget =
    !!source &&
    source.from >= target.pos + 1 &&
    source.to <= target.pos + target.node.nodeSize - 1

  let existingNode = target.node
  let existingPos = target.pos
  let effectiveSource = source
  if (sourceInsideTarget && source) {
    tr.delete(source.from, source.to)
    existingPos = tr.mapping.map(target.pos)
    const live = tr.doc.nodeAt(existingPos)
    if (!live || live.type !== target.node.type) return null
    existingNode = live
    effectiveSource = null
  }

  const newCell = columnType.create(null, droppedFitted)
  const existingCell = columnType.create(null, existingNode)
  const cells = zone === 'LEFT' ? [newCell, existingCell] : [existingCell, newCell]
  const layout = layoutType.create({ columns: cells.length }, cells)
  return replaceContent(
    tr,
    existingPos,
    existingPos + existingNode.nodeSize,
    layout,
    effectiveSource,
  )
}

function sourceCoversTarget(
  source: { from: number; to: number } | null,
  target: HoverTarget,
): boolean {
  if (!source) return false
  return source.from <= targetStart(target) && targetEnd(target) <= source.to
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
  const source = moved || view.dragging ? dragSourceRange(view, slice.content) : null
  const schema = view.state.schema
  const columnType = schema.nodes.column
  const layoutType = schema.nodes.columnLayout
  if (!columnType || !layoutType) return false

  // Source-overlaps-target guard: if the dragged range covers the target node
  // we'd delete and re-wrap our own target — produces nonsense. Bail out.
  if (sourceCoversTarget(source, target)) return false

  // If the drag source is itself a column (cell-handle drag), drop its
  // content, not the column wrapper — wrapping a column in another column
  // produces a schema-invalid `column > column > block+` tree that
  // NodeType.create silently allows.
  const sourceFirstChild = slice.content.firstChild
  const droppedContent: Fragment =
    sourceFirstChild?.type === columnType ? sourceFirstChild.content : slice.content

  // Wrap non-block sources (e.g. a `taskItem` dragged out of its list) so they
  // satisfy `block+` — the content rule shared by `column` and the top-level
  // doc, which covers every insertion site below.
  const droppedFitted = wrapForContent(droppedContent, columnType)
  if (!droppedFitted) return false

  if (zone === 'TOP' || zone === 'BOTTOM') {
    const insertPos = computeReorderPos(target, zone)
    tr = insertContent(tr, insertPos, droppedFitted, source)
  } else if (target.kind === 'block') {
    const built = buildBlockTargetTransaction(
      view,
      zone,
      target,
      source,
      droppedFitted,
      columnType,
      layoutType,
    )
    if (!built) return false
    tr = built
  } else {
    // LEFT/RIGHT on a cell — insert a sibling cell into the layout.
    const newCell = columnType.create(null, droppedFitted)
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
    tr.setSelection(nearestTextSelection(tr.doc, tr.selection.from))
  }
  view.dispatch(tr.setMeta(dropPlacementKey, CLEARED))
  const cleanup = dissolveColumnLayouts(view.state)
  if (cleanup) {
    view.dispatch(cleanup.setMeta(dropPlacementKey, CLEARED))
  }
  event.preventDefault()
  return true
}

function renderIndicatorDecoration(doc: PMNode, state: PluginState | undefined): DecorationSet {
  // `Decoration.node` adds a class to the target's own DOM node, and a ::before
  // pseudo-element draws the bar. Widget-based decorations are anchored to the
  // insertion point in the DOM tree, which for atom blocks (e.g. images) sits
  // BETWEEN top-level elements with no positioned ancestor — the bar then
  // stretches to the editor's height. The node-class approach keeps the bar
  // inside the target's box so it always matches its height/width.
  if (!state?.zone || !state.target) return DecorationSet.empty
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
            return renderIndicatorDecoration(state.doc, dropPlacementKey.getState(state))
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
              if (!next || !view.dom.contains(next)) setPlacement(view, CLEARED)
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
