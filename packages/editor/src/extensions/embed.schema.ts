import { Node, mergeAttributes } from '@tiptap/core'

import { normalizeLinkHref } from '../link-href'

export type EmbedAttrs = {
  url: string
  provider: string
  embedUrl: string
}

// Schema-only `embed` node (spec §4 + §7 invariant 1). An embed is a sandboxed
// iframe over a PROVIDER-ALLOWLIST-TRANSFORMED url. The client re-extends this
// (embed.tsx) with the iframe NodeView; the SERVER extension set uses this
// variant as-is so PDF/HTML export renders a plain LINK TO THE ORIGINAL — never
// an `<iframe>` (an iframe doesn't belong in an export, and the export context
// has no allowlist guard).
//
// SECURITY: `embedUrl` is only ever written from `resolveEmbed` (the allowlist).
// The render here still passes both urls through `normalizeLinkHref` as a second
// gate so a crafted Yjs update can't smuggle a javascript:/data: value.
export const EmbedSchema = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: { default: '' },
      provider: { default: '' },
      embedUrl: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-type="embed"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            url: el.getAttribute('data-url') ?? '',
            provider: el.getAttribute('data-provider') ?? '',
            embedUrl: el.getAttribute('data-embed-url') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ node }) {
    const attrs = node.attrs as EmbedAttrs
    const safeUrl = normalizeLinkHref(attrs.url)
    const safeEmbedUrl = normalizeLinkHref(attrs.embedUrl)
    // Export fallback: a link to the ORIGINAL url, never an iframe. Built
    // explicitly so the raw attrs can't leak an unsanitized url back in.
    return [
      'a',
      mergeAttributes({
        'data-type': 'embed',
        'data-url': safeUrl,
        'data-provider': attrs.provider,
        'data-embed-url': safeEmbedUrl,
        class: 'anynote-embed-fallback',
        href: safeUrl,
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      }),
      safeUrl || 'Встраивание',
    ]
  },
})
