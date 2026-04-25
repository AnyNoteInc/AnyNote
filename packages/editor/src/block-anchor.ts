import type { Editor } from "@tiptap/core"

const BLOCK_FLASH_CLASS = "block-flash"
const BLOCK_FLASH_DURATION_MS = 3000

export function scrollToBlockIndex(editor: Editor, index: number): boolean {
  const root = editor.view.dom
  // Drop any leftover flash so a follow-up navigation doesn't leave two
  // highlighted blocks at once.
  root.querySelectorAll(`.${BLOCK_FLASH_CLASS}`).forEach((el) => {
    el.classList.remove(BLOCK_FLASH_CLASS)
  })
  const target = root.querySelector(`[data-block-index="${index}"]`)
  if (!(target instanceof HTMLElement)) return false
  target.scrollIntoView({ block: "center", behavior: "smooth" })
  target.classList.add(BLOCK_FLASH_CLASS)
  window.setTimeout(() => target.classList.remove(BLOCK_FLASH_CLASS), BLOCK_FLASH_DURATION_MS)
  return true
}
