import { Node, mergeAttributes } from '@tiptap/core'

import { normalizeLinkHref } from '../link-href'

export type BookmarkAttrs = {
  url: string
  title: string
  description: string
  image: string
  favicon: string
}

// Schema-only `bookmark` node (spec §4). A bookmark is a rich link card: the URL
// plus best-effort og:title/description/image/favicon fetched at insert time.
// The client re-extends this (bookmark.tsx) with a card NodeView; the SERVER
// extension set uses this variant as-is so PDF/HTML export renders a titled link
// card (NEVER an iframe). Every URL attr passes `normalizeLinkHref` on render so
// a crafted Yjs update can't smuggle a javascript:/data: payload into an href or
// <img src>.
export const BookmarkSchema = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: '' },
      title: { default: '' },
      description: { default: '' },
      image: { default: '' },
      favicon: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-type="bookmark"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            url: el.getAttribute('data-url') ?? '',
            title: el.getAttribute('data-title') ?? '',
            description: el.getAttribute('data-description') ?? '',
            image: el.getAttribute('data-image') ?? '',
            favicon: el.getAttribute('data-favicon') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ node }) {
    const attrs = node.attrs as BookmarkAttrs
    // Sanitize every URL: a javascript:/data: value drops to '' so neither the
    // href nor a round-trippable data-* can carry a payload into export.
    const safeUrl = normalizeLinkHref(attrs.url)
    const safeImage = normalizeLinkHref(attrs.image)
    const safeFavicon = normalizeLinkHref(attrs.favicon)
    const host = (() => {
      try {
        return new URL(safeUrl).hostname
      } catch {
        return ''
      }
    })()
    // Export fallback: a titled link card (an anchor), never an iframe. Built
    // explicitly so the raw attrs can't leak an unsanitized url back in.
    return [
      'a',
      mergeAttributes({
        'data-type': 'bookmark',
        'data-url': safeUrl,
        'data-title': attrs.title,
        'data-description': attrs.description,
        'data-image': safeImage,
        'data-favicon': safeFavicon,
        class: 'anynote-bookmark',
        href: safeUrl,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      }),
      ['span', { class: 'anynote-bookmark__title' }, attrs.title || safeUrl || 'Закладка'],
      ...(attrs.description
        ? [['span', { class: 'anynote-bookmark__description' }, attrs.description] as const]
        : []),
      ['span', { class: 'anynote-bookmark__host' }, host],
    ]
  },
})
