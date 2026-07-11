import type { Editor } from '@tiptap/core'

import type { InlineAiCapturedRange } from '../components/inline-ai-popover'
import { liveRectAnchor } from './live-rect-anchor'

/**
 * Build the inline-AI capture for the whole block under the drag handle (the
 * six-dots menu «Спросить AI»). The range is the block's INNER content —
 * `pos + 1 .. pos + nodeSize − 1`, the handleTextColor precedent — so the
 * accepted transform replaces the content while the block container survives
 * (a heading stays a heading). Returns null for blocks with nothing to
 * transform (atom leaves like images/dividers, empty blocks) — callers hide
 * the menu item.
 */
export function blockAskAiCapture(editor: Editor, pos: number): InlineAiCapturedRange | null {
  const node = editor.state.doc.resolve(pos).nodeAfter
  if (!node || node.isAtom || node.nodeSize < 2) return null
  const from = pos + 1
  const to = pos + node.nodeSize - 1
  if (to <= from) return null
  const selectedText = editor.state.doc.textBetween(from, to, ' ')
  if (!selectedText.trim()) return null
  // Anchor the popover to the block's DOM node (stable, tracked by Popper);
  // fall back to a live rect over the range when the node has no own element.
  const dom = editor.view.nodeDOM(pos)
  const anchorEl =
    dom instanceof HTMLElement ? dom : liveRectAnchor(editor, () => ({ from, to }))
  if (!anchorEl) return null
  return { from, to, selectedText, anchorEl }
}
