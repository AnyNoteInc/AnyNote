import { Node, mergeAttributes } from '@tiptap/core'

import { formatIsoForDisplay } from '../lib/date-format'

export type DateKind = 'date' | 'datetime'

export type DateNodeAttrs = {
  value: string
  kind: DateKind
}

// Inline atom node holding an ISO `value` + `kind`. Display text is derived from
// the value so the locale/format can change later; renderHTML emits the readable
// text so MD/HTML export and "copy text" produce human-readable dates.
export const DateSchema = Node.create({
  name: 'date',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      value: { default: '' },
      kind: { default: 'date' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="date"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          const kind = el.getAttribute('data-kind') === 'datetime' ? 'datetime' : 'date'
          return { value: el.getAttribute('data-value') ?? '', kind }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as DateNodeAttrs
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'date',
        'data-value': attrs.value,
        'data-kind': attrs.kind,
      }),
      formatIsoForDisplay(attrs.value, attrs.kind),
    ]
  },
})
