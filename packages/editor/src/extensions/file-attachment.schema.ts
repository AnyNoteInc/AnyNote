import { Node, mergeAttributes } from '@tiptap/core'

export const FileAttachmentSchema = Node.create({
  name: 'fileAttachment',
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
      ext: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="file-attachment"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            url: el.getAttribute('data-url') ?? '',
            name: el.getAttribute('data-name') ?? '',
            size: Number(el.getAttribute('data-size') ?? 0),
            mimeType: el.getAttribute('data-mime') ?? '',
            ext: el.getAttribute('data-ext') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as { url: string; name: string; size: number; mimeType: string; ext: string }
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'file-attachment',
        'data-url': attrs.url,
        'data-name': attrs.name,
        'data-size': String(attrs.size),
        'data-mime': attrs.mimeType,
        'data-ext': attrs.ext,
      }),
    ]
  },
})
