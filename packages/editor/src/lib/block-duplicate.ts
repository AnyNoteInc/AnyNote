import type { Editor } from "@tiptap/core"

// Duplicates the block at `pos` by serializing it to JSON and inserting a copy
// immediately after. Uses resolve(pos).nodeAfter because drag-handle positions
// point to the slot *before* the block, and doc.nodeAt(pos) at that coordinate
// returns the parent, not the block itself.
export function duplicateBlock(editor: Editor, pos: number): boolean {
  const $pos = editor.state.doc.resolve(pos)
  const node = $pos.nodeAfter
  if (!node) return false
  const json = node.toJSON()
  const insertAt = pos + node.nodeSize
  return editor.chain().focus().insertContentAt(insertAt, json).run()
}
