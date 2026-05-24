export function findClickedLink(target: EventTarget | null, root: HTMLElement) {
  if (target instanceof HTMLAnchorElement) return target
  if (!(target instanceof HTMLElement)) return null

  const link = target.closest<HTMLAnchorElement>('a')
  if (!link || !root.contains(link)) return null

  return link
}

export function shouldOpenLink(event: MouseEvent) {
  return event.metaKey || event.altKey
}

export function openLinkInNewWindow(link: HTMLAnchorElement) {
  window.open(link.href, '_blank', 'noopener,noreferrer')
}
