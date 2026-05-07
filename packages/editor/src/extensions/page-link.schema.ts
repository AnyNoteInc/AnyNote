import { Node, mergeAttributes } from '@tiptap/core'

export const PageLinkSchema = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      pageId: { default: '' },
      workspaceId: { default: '' },
      title: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="page-link"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            pageId: el.getAttribute('data-page-id') ?? '',
            workspaceId: el.getAttribute('data-workspace-id') ?? '',
            title: el.getAttribute('data-title') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as { pageId: string; workspaceId: string; title: string }
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page-link',
        'data-page-id': attrs.pageId,
        'data-workspace-id': attrs.workspaceId,
        'data-title': attrs.title,
      }),
      attrs.title || 'Без названия',
    ]
  },
})
