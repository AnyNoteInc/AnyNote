import type { Editor } from "@tiptap/core"

// Duplicates the block at `pos` by serializing it to JSON and inserting a copy
// immediately after. Works for any node type since it uses the raw JSON form.
export function duplicateBlock(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return false
  const json = node.toJSON()
  const insertAt = pos + node.nodeSize
  return editor.chain().focus().insertContentAt(insertAt, json).run()
}
