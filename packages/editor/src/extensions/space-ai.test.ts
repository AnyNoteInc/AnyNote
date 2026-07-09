import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'

import { findSpaceAiTrigger } from './space-ai'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    blockquote: {
      group: 'block',
      content: 'block+',
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: () => ['blockquote', 0],
    },
  },
})

const para = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)

function stateWithSelection(
  doc: ReturnType<typeof schema.nodes.doc.create>,
  pos: number,
): EditorState {
  const base = EditorState.create({ schema, doc })
  return base.apply(base.tr.setSelection(TextSelection.create(base.doc, pos)))
}

describe('findSpaceAiTrigger', () => {
  it('fires on an empty top-level paragraph with a caret', () => {
    const doc = schema.nodes.doc.create(null, [para('Текст выше'), para('')])
    // Caret inside the empty paragraph: after "Текст выше" (node size 12), pos 13.
    const state = stateWithSelection(doc, 13)
    expect(findSpaceAiTrigger(state)).toEqual({ pos: 13 })
  })

  it('does not fire in a non-empty paragraph', () => {
    const doc = schema.nodes.doc.create(null, [para('Привет')])
    const state = stateWithSelection(doc, 3)
    expect(findSpaceAiTrigger(state)).toBeNull()
  })

  it('does not fire with a non-empty selection', () => {
    const doc = schema.nodes.doc.create(null, [para('Привет')])
    const base = EditorState.create({ schema, doc })
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 1, 4)))
    expect(findSpaceAiTrigger(state)).toBeNull()
  })

  it('does not fire inside a nested block (depth > 1)', () => {
    const doc = schema.nodes.doc.create(null, [schema.nodes.blockquote.create(null, [para('')])])
    // Empty paragraph inside blockquote: caret pos 2 → depth 2.
    const state = stateWithSelection(doc, 2)
    expect(findSpaceAiTrigger(state)).toBeNull()
  })
})
