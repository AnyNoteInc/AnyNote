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

export function dissolveColumnLayouts(state: EditorState): Transaction | null {
  const { doc, tr } = state
  let mutated = false
  // Walk top-level children right-to-left so position math stays valid as we splice.
  const layouts: { node: PMNode; pos: number }[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'columnLayout') layouts.push({ node, pos: offset })
  })
  for (let i = layouts.length - 1; i >= 0; i--) {
    const entry = layouts[i]
    if (!entry) continue
    const { node: layout, pos } = entry
    const cells: { node: PMNode; localStart: number; empty: boolean }[] = []
    let cursor = 0
    layout.forEach((cell: PMNode) => {
      cells.push({ node: cell, localStart: cursor, empty: isColumnEmpty(cell) })
      cursor += cell.nodeSize
    })
    const nonEmpty = cells.filter((c) => !c.empty)

    if (nonEmpty.length === 0) {
      tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + layout.nodeSize))
      mutated = true
      continue
    }

    if (nonEmpty.length === 1) {
      const onlyCellEntry = nonEmpty[0]
      if (!onlyCellEntry) continue
      const onlyCell = onlyCellEntry.node
      const inner = onlyCell.content
      tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + layout.nodeSize), inner)
      mutated = true
      continue
    }

    // 2 or 3 non-empty: remove empty cells if any
    const hasEmpty = cells.some((c) => c.empty)
    if (hasEmpty) {
      const replacement = layout.type.create(
        layout.attrs,
        nonEmpty.map((c) => c.node),
      )
      tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + layout.nodeSize), replacement)
      mutated = true
    }
  }
  return mutated ? tr : null
}
