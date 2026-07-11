import type { Editor } from '@tiptap/core'

import { getInlineAiPreview } from '../extensions/inline-ai'
import type { VirtualAnchor } from '../types'

/** A LIVE virtual anchor over a document range. Consumed by the InlineAI
 *  POPPER (popper.js virtual element): `getBoundingClientRect` recomputes from
 *  the current positions — preferring the InlineAI plugin's drift-guarded
 *  'capturing' hold over the caller's fallback range — and `contextElement`
 *  points popper at the editor DOM so it re-positions when the page's INNER
 *  scroll container scrolls (a frozen rect left the popup floating detached
 *  mid-page).
 *  Do NOT add `nodeType: 1` here: that is the MUI *Popover* contract (types.ts
 *  VirtualAnchor) — on a Popper it makes MUI treat the object as a live DOM
 *  element and dev-warn about zero rects. Conversely, if this anchor is ever
 *  fed to a Popover again, nodeType becomes REQUIRED or MUI silently anchors
 *  to document.body (the popup lands at the viewport bottom). */
export function liveRectAnchor(
  editor: Editor,
  fallbackRange: () => { from: number; to: number },
): VirtualAnchor | null {
  const computeRect = (): DOMRect => {
    const held = getInlineAiPreview(editor)
    const range = held.active && held.status === 'capturing' ? held : fallbackRange()
    const start = editor.view.coordsAtPos(range.from)
    const end = editor.view.coordsAtPos(range.to)
    const left = Math.min(start.left, end.left)
    const top = Math.min(start.top, end.top)
    const right = Math.max(start.right, end.right)
    const bottom = Math.max(start.bottom, end.bottom)
    return new DOMRect(left, top, right - left, bottom - top)
  }
  try {
    // Validate up-front (preserving the null fallback) and keep the last good
    // rect for moments when a recompute throws mid-scroll.
    let lastRect = computeRect()
    return {
      contextElement: editor.view.dom,
      getBoundingClientRect: () => {
        if (!editor.isDestroyed) {
          try {
            lastRect = computeRect()
          } catch {
            // keep the last good rect
          }
        }
        return lastRect
      },
    }
  } catch {
    return null
  }
}
