// Vertical alignment for the block controls: the handle must be centered on the
// FIRST rendered line of the hovered block — not its top edge (looks too high on
// tall h1/h2) and not the block's middle (drifts down on multi-line paragraphs).
// floating-ui's `left-start` placement top-aligns the handle with the block, so
// the crossAxis offset computed here shifts it down to the first-line center.

const MAX_TEXT_NODE_PROBES = 50

/**
 * Center Y of the block's first rendered line, in pixels from the block's
 * border-box top. Measured from the first visible text line box; blocks
 * without rendered text (images, dividers, empty paragraphs) fall back to a
 * one-line-height band clamped to the block's own center.
 */
export function firstLineCenter(dom: HTMLElement): number {
  const blockRect = dom.getBoundingClientRect()
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT)
  for (let probes = 0; probes < MAX_TEXT_NODE_PROBES; probes += 1) {
    const text = walker.nextNode()
    if (!text) break
    if (!text.nodeValue || text.nodeValue.trim().length === 0) continue
    const range = document.createRange()
    range.selectNodeContents(text)
    // The first client rect of the range is the first line box of that text
    // node; hidden text (display:none toolbars etc.) yields no rects and is
    // skipped in favor of the next text node.
    const rect = range.getClientRects()[0]
    if (rect && rect.height > 0) {
      return rect.top - blockRect.top + rect.height / 2
    }
  }
  const style = window.getComputedStyle(dom)
  const fontSize = Number.parseFloat(style.fontSize)
  const parsedLineHeight = Number.parseFloat(style.lineHeight)
  const lineHeight = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : Number.isFinite(fontSize)
      ? fontSize * 1.2
      : 24
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0
  return Math.min(borderTop + paddingTop + lineHeight / 2, blockRect.height / 2)
}

/**
 * floating-ui `offset().crossAxis` that moves the handle from top-aligned
 * (`left-start`) to first-line-centered. Positive crossAxis shifts the handle
 * down. Falls back to top alignment when the hovered DOM node is unknown.
 */
export function dragHandleCrossAxis(dom: HTMLElement | null, handleHeight: number): number {
  if (!dom) return 0
  return firstLineCenter(dom) - handleHeight / 2
}
