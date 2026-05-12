import { Node, mergeAttributes } from '@tiptap/core'

export const ReminderSchema = Node.create({
  name: 'reminder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-id') ?? '',
        renderHTML: (attrs) => ({ 'data-id': attrs.id }),
      },
      dueAt: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-due-at') ?? '',
        renderHTML: (attrs) => ({ 'data-due-at': attrs.dueAt }),
      },
      offsets: {
        default: [1440, 0] as number[],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-offsets') ?? '[]') as number[]
          } catch {
            return []
          }
        },
        renderHTML: (attrs) => ({ 'data-offsets': JSON.stringify(attrs.offsets) }),
      },
      audience: {
        default: 'ME' as 'ME' | 'WORKSPACE' | 'LIST',
        parseHTML: (el) =>
          (el.getAttribute('data-audience') ?? 'ME') as 'ME' | 'WORKSPACE' | 'LIST',
        renderHTML: (attrs) => ({ 'data-audience': attrs.audience }),
      },
      label: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
      recipients: {
        default: [] as string[],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-recipients') ?? '[]') as string[]
          } catch {
            return []
          }
        },
        renderHTML: (attrs) =>
          attrs.recipients?.length ? { 'data-recipients': JSON.stringify(attrs.recipients) } : {},
      },
      doneAt: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-done-at') || null,
        renderHTML: (attrs) => (attrs.doneAt ? { 'data-done-at': attrs.doneAt } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="reminder"]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'reminder' }),
      node.attrs.label ? String(node.attrs.label) : '🔔',
    ]
  },
})
