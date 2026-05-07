import { Node, mergeAttributes } from '@tiptap/core'

export const HiddenTextSchema = Node.create({
  name: 'hiddenText',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      created: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('data-created')
          if (!raw) return null
          const value = Number.parseInt(raw, 10)
          return Number.isFinite(value) ? value : null
        },
        renderHTML: (attrs) =>
          typeof attrs.created === 'number' ? { 'data-created': String(attrs.created) } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="hidden-text"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'hidden-text' }), 0]
  },
})
