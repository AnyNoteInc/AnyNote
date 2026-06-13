import { Node, mergeAttributes } from '@tiptap/core'

import { normalizeLinkHref } from '../link-href'

export type VideoAttrs = {
  url: string
  name: string
  size: number
  mimeType: string
  width: number | null
}

// Schema-only `video` node. The client re-extends this (video.tsx) with an
// inline `<video controls>` NodeView; the SERVER extension set uses this variant
// as-is so PDF/HTML export renders a plain download link — no `<video>` element
// belongs in an export.
export const VideoSchema = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: '' },
      name: { default: '' },
      size: { default: 0 },
      mimeType: { default: '' },
      // Transient marker used by the file-upload routing to re-find a freshly
      // inserted placeholder after its async upload resolves. Not rendered to /
      // parsed from the DOM so it never persists in saved content.
      uploadId: { default: null, rendered: false },
      width: {
        default: null,
        parseHTML: (element) => {
          const w = element.getAttribute('data-width')
          if (!w) return null
          const n = Number(w)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) => {
          const w = attrs.width as number | null
          return w ? { 'data-width': String(w) } : {}
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-type="video"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            url: el.getAttribute('data-url') ?? '',
            name: el.getAttribute('data-name') ?? '',
            size: Number(el.getAttribute('data-size') ?? 0),
            mimeType: el.getAttribute('data-mime') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ node }) {
    const attrs = node.attrs as VideoAttrs
    // Sanitize once: a javascript:/data: url drops to '' so neither the
    // executable href nor the round-trippable data-url can carry a payload.
    const safeUrl = normalizeLinkHref(attrs.url)
    // Export fallback: a download link, never a <video> element. We rebuild the
    // attribute set explicitly (instead of spreading HTMLAttributes) so the raw
    // attrs can't leak the unsanitized url back in.
    return [
      'a',
      mergeAttributes({
        'data-type': 'video',
        'data-url': safeUrl,
        'data-name': attrs.name,
        'data-size': String(attrs.size),
        'data-mime': attrs.mimeType,
        href: safeUrl,
        download: attrs.name,
        rel: 'noopener noreferrer',
      }),
      `🎬 ${attrs.name || 'Видео'}`,
    ]
  },
})
