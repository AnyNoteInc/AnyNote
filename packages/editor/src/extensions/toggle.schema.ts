import { Node, mergeAttributes } from '@tiptap/core'

export const ToggleSchema = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-open') !== 'false',
        renderHTML: (attrs) => ({ 'data-open': attrs.open ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle' }), 0]
  },
})
