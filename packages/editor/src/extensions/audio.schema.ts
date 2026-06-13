import { Node, mergeAttributes } from '@tiptap/core'

import { normalizeLinkHref } from '../link-href'

export type AudioAttrs = {
  url: string
  name: string
  size: number
  mimeType: string
}

// Schema-only `audio` node. The client re-extends this (audio.tsx) with an inline
// `<audio controls>` NodeView; the SERVER extension set uses this variant as-is so
// PDF/HTML export renders a plain download link — no `<audio>` in an export.
export const AudioSchema = Node.create({
  name: 'audio',
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
      // Transient marker (see video.schema.ts). Not rendered / parsed.
      uploadId: { default: null, rendered: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-type="audio"]',
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
    const attrs = node.attrs as AudioAttrs
    // Sanitize once (see video.schema.ts): a javascript:/data: url drops to ''.
    const safeUrl = normalizeLinkHref(attrs.url)
    // Export fallback: a download link, never an <audio> element. Built
    // explicitly so the raw attrs can't leak the unsanitized url back in.
    return [
      'a',
      mergeAttributes({
        'data-type': 'audio',
        'data-url': safeUrl,
        'data-name': attrs.name,
        'data-size': String(attrs.size),
        'data-mime': attrs.mimeType,
        href: safeUrl,
        download: attrs.name,
        rel: 'noopener noreferrer',
      }),
      `🎵 ${attrs.name || 'Аудио'}`,
    ]
  },
})
