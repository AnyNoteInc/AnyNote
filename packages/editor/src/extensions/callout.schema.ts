import { Node, mergeAttributes } from '@tiptap/core'

const DEFAULT_EMOJI = '💡'

export const CalloutSchema = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      emoji: { default: DEFAULT_EMOJI },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            emoji: el.getAttribute('data-emoji') || DEFAULT_EMOJI,
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        'data-emoji': (node.attrs.emoji as string) || DEFAULT_EMOJI,
      }),
      0,
    ]
  },
})
