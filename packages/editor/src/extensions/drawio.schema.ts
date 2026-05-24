import { Node, mergeAttributes } from '@tiptap/core'

export const DrawioSchema = Node.create({
  name: 'drawio',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      xml: { default: '' },
      svg: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="drawio"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            xml: el.getAttribute('data-xml') ?? '',
            svg: el.querySelector('img')?.getAttribute('src') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as { xml: string; svg: string }
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'drawio', 'data-xml': attrs.xml }),
      ['img', { src: attrs.svg, alt: '' }],
    ]
  },
})
