import type { Editor } from "@tiptap/core"

import { blockFlashKey } from "./extensions/block-index-attributes"

const BLOCK_FLASH_DURATION_MS = 3000

export function scrollToBlockIndex(editor: Editor, index: number): boolean {
  const target = editor.view.dom.querySelector(`[data-block-index="${index}"]`)
  if (!(target instanceof HTMLElement)) return false
  target.scrollIntoView({ block: "center", behavior: "smooth" })
  editor.view.dispatch(editor.state.tr.setMeta(blockFlashKey, { type: "set", index }))
  window.setTimeout(() => {
    if (editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(blockFlashKey, { type: "clear" }))
  }, BLOCK_FLASH_DURATION_MS)
  return true
}
