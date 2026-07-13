import type { Editor } from '@tiptap/core'

// Replaces the node occupying [pos, pos + nodeSize) with `swap` (a node-JSON) in
// one focused transaction. Shared by every "convert this media node to another
// kind" affordance — file⇄image (block menu), video/audio→file — so the swap
// mechanics (focus handling, range) live in one place.
export function replaceNodeAt(editor: Editor, pos: number, nodeSize: number, swap: object): boolean {
  return editor
    .chain()
    .focus()
    .insertContentAt({ from: pos, to: pos + nodeSize }, swap)
    .run()
}
