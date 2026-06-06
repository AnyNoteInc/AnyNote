import type { Editor } from '@tiptap/core'

export function findClickedLink(target: EventTarget | null, root: HTMLElement) {
  if (target instanceof HTMLAnchorElement) {
    if (!root.contains(target)) return null
    return target
  }
  if (!(target instanceof HTMLElement)) return null

  const link = target.closest<HTMLAnchorElement>('a')
  if (!link || !root.contains(link)) return null

  return link
}

/**
 * View mode: a plain left click opens the link.
 * Edit mode: a left click only opens with a modifier, so a plain click can
 * still place the caret for editing the link text.
 */
export function shouldOpenLink(event: MouseEvent, editable: boolean) {
  if (!editable) return event.button === 0
  return event.metaKey || event.ctrlKey || event.altKey
}

export function openLinkInNewWindow(link: HTMLAnchorElement) {
  window.open(link.href, '_blank', 'noopener,noreferrer')
}

/**
 * Attaches a capture-phase click listener that opens links per shouldOpenLink.
 * Reads editor.isEditable at click time so the same handler works whether the
 * editor is mounted editable or read-only. Returns a cleanup function.
 */
export function attachLinkClickHandler(editor: Editor) {
  const dom = editor.view.dom

  const handleClick = (event: Event) => {
    const mouse = event as MouseEvent
    const link = findClickedLink(mouse.target, dom as HTMLElement)
    if (!link) return
    if (!shouldOpenLink(mouse, editor.isEditable)) return

    event.preventDefault()
    event.stopPropagation()
    openLinkInNewWindow(link)
  }

  dom.addEventListener('click', handleClick, { capture: true })
  return () => dom.removeEventListener('click', handleClick, { capture: true })
}
