import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

// A column is empty if it has no children OR every child is an empty paragraph
// (a paragraph with content.size === 0). This handles the production case where
// dragging the last block out of a cell leaves ProseMirror's schema-fill
// placeholder behind.
function isColumnEmpty(column: PMNode): boolean {
  if (column.childCount === 0) return true
  let allEmptyParagraphs = true
  column.forEach((child) => {
    if (child.type.name !== 'paragraph' || child.content.size > 0) {
      allEmptyParagraphs = false
    }
  })
  return allEmptyParagraphs
}

function layoutAttrs(layout: PMNode, columns: number): Record<string, unknown> {
  return { ...layout.attrs, columns }
}

export function dissolveColumnLayoutsInTransaction(tr: Transaction): boolean {
  const { doc } = tr
  let mutated = false
  // Walk every column layout right-to-left so position math stays valid as we splice.
  const layouts: { node: PMNode; pos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'columnLayout') {
      layouts.push({ node, pos })
      return false
    }
    return true
  })
  for (let i = layouts.length - 1; i >= 0; i--) {
    const entry = layouts[i]
    if (!entry) continue
    const { node: layout, pos } = entry
    const cells: { node: PMNode; empty: boolean }[] = []
    layout.forEach((cell: PMNode) => {
      cells.push({ node: cell, empty: isColumnEmpty(cell) })
    })
    const nonEmpty = cells.filter((c) => !c.empty)

    if (nonEmpty.length === 0) {
      tr.delete(pos, pos + layout.nodeSize)
      mutated = true
      continue
    }

    if (nonEmpty.length === 1) {
      const onlyCellEntry = nonEmpty[0]
      if (!onlyCellEntry) continue
      const onlyCell = onlyCellEntry.node
      const inner = onlyCell.content
      tr.replaceWith(pos, pos + layout.nodeSize, inner)
      mutated = true
      continue
    }

    // 2 or 3 non-empty: remove empty cells if any
    const hasEmpty = cells.some((c) => c.empty)
    if (hasEmpty) {
      const replacement = layout.type.create(
        layoutAttrs(layout, nonEmpty.length),
        nonEmpty.map((c) => c.node),
      )
      tr.replaceWith(pos, pos + layout.nodeSize, replacement)
      mutated = true
      continue
    }

    if (layout.attrs.columns !== layout.childCount) {
      tr.setNodeMarkup(pos, undefined, layoutAttrs(layout, layout.childCount))
      mutated = true
    }
  }
  return mutated
}

export function dissolveColumnLayouts(state: EditorState): Transaction | null {
  const tr = state.tr
  const mutated = dissolveColumnLayoutsInTransaction(tr)
  return mutated ? tr : null
}
