// Pure tests for the InlineAI streaming-preview plugin core (spec §4.2/§4.3,
// §7 invariant 5). No React, node env — we drive a bare ProseMirror EditorState
// holding the InlineAI plugin and dispatch the meta-actions directly, asserting:
//   - start sets active + range + empty text
//   - appendToken concatenates
//   - the stored {from,to} re-maps through an unrelated insertion BEFORE from
//     (the drift guard) — insert N chars at 0 → from/to shift by N
//   - clear resets to inactive
//   - finish sets status:'done'
//   - applyInlineAiResult (accept) for a replace action removes [from,to] and
//     inserts the text at from, in ONE transaction; for expand it appends at to
//     leaving the original; after accept the plugin state is inactive
//   - discard (clear) yields a byte-identical doc to before start
//   - retry resets the preview (clear → start again)

import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, type Transaction } from '@tiptap/pm/state'

import {
  inlineAiPlugin,
  inlineAiPluginKey,
  inlineAiStartMeta,
  inlineAiAppendTokenMeta,
  inlineAiFinishMeta,
  inlineAiFailMeta,
  inlineAiClearMeta,
  buildInlineAiAcceptTransaction,
  type InlineAiPreviewState,
} from './inline-ai'

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
  },
})

const para = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)

const stateFrom = (text: string): EditorState =>
  EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [para(text)]),
    plugins: [inlineAiPlugin],
  })

const previewState = (state: EditorState): InlineAiPreviewState => {
  const s = inlineAiPluginKey.getState(state)
  if (!s) throw new Error('plugin state missing')
  return s
}

const apply = (state: EditorState, mutate: (tr: Transaction) => void): EditorState => {
  const tr = state.tr
  mutate(tr)
  return state.apply(tr)
}

describe('inline-ai plugin state', () => {
  it('start meta sets active with the given range and empty text', () => {
    // doc: <p>Hello world</p> — select "Hello" (positions 1..6)
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'summarize' })),
    )
    const s = previewState(state)
    expect(s.active).toBe(true)
    expect(s.from).toBe(1)
    expect(s.to).toBe(6)
    expect(s.action).toBe('summarize')
    expect(s.text).toBe('')
    expect(s.status).toBe('streaming')
  })

  it('appendToken concatenates onto the accumulated text', () => {
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'rewrite' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Прив')))
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('ет')))
    expect(previewState(state).text).toBe('Привет')
  })

  it('re-maps the stored {from,to} when an unrelated insertion happens BEFORE from (drift guard)', () => {
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'shorten' })),
    )
    // A collaborator inserts "XYZ" (3 chars) at the very start (pos 1).
    state = apply(state, (tr) => tr.insertText('XYZ', 1))
    const s = previewState(state)
    // The pending range must have shifted right by 3.
    expect(s.from).toBe(4)
    expect(s.to).toBe(9)
    // And it still covers the original "Hello".
    expect(state.doc.textBetween(s.from, s.to)).toBe('Hello')
  })

  it('finish meta sets status to done, keeping the text', () => {
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'grammar' })),
    )
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Done text')),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiFinishMeta()))
    const s = previewState(state)
    expect(s.status).toBe('done')
    expect(s.text).toBe('Done text')
    expect(s.active).toBe(true)
  })

  it('fail meta sets status error with the message', () => {
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'rewrite' })),
    )
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiFailMeta('Слишком много запросов')),
    )
    const s = previewState(state)
    expect(s.status).toBe('error')
    expect(s.error).toBe('Слишком много запросов')
  })

  it('clear meta resets to inactive', () => {
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'rewrite' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiClearMeta()))
    expect(previewState(state).active).toBe(false)
  })
})

describe('buildInlineAiAcceptTransaction', () => {
  it('replace action removes [from,to] and inserts the text at from, in ONE transaction', () => {
    // doc: <p>Hello world</p>, preview over "Hello" → replace with "Привет".
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'summarize' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Привет')))
    const tr = buildInlineAiAcceptTransaction(state)
    expect(tr).not.toBeNull()
    // Exactly one transaction = one undo step (the whole accept).
    const next = state.apply(tr!)
    expect(next.doc.textContent).toBe('Привет world')
    // And the transaction also cleared the preview (the same tr carries the meta).
    expect(previewState(next).active).toBe(false)
  })

  it('expand action inserts at to, leaving the original selection intact', () => {
    // doc: <p>Hello world</p>, preview over "Hello" → expand appends " (greeting)".
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'expand' })),
    )
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta(' (greeting)')),
    )
    const tr = buildInlineAiAcceptTransaction(state)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)
    // Original "Hello" preserved; the expansion inserted right after it (at `to`).
    expect(next.doc.textContent).toBe('Hello (greeting) world')
    expect(previewState(next).active).toBe(false)
  })

  it('returns null when no preview is active', () => {
    const state = stateFrom('Hello world')
    expect(buildInlineAiAcceptTransaction(state)).toBeNull()
  })

  it('accept uses the CURRENT mapped range (after a drift), not the captured one', () => {
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'summarize' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Hi')))
    // Collaborator inserts 3 chars at the start; the range drifts 1..6 → 4..9.
    state = apply(state, (tr) => tr.insertText('XYZ', 1))
    const tr = buildInlineAiAcceptTransaction(state)
    const next = state.apply(tr!)
    // "XYZ" preserved, the drifted "Hello" replaced by "Hi".
    expect(next.doc.textContent).toBe('XYZHi world')
  })
})

describe('discard / retry invariants', () => {
  it('discard (clear) yields a byte-identical doc to before start', () => {
    const before = stateFrom('Hello world')
    const beforeJson = JSON.stringify(before.doc.toJSON())
    let state = apply(before, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'rewrite' })),
    )
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('streamed preview never lands')),
    )
    // Discard.
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiClearMeta()))
    expect(JSON.stringify(state.doc.toJSON())).toBe(beforeJson)
    expect(previewState(state).active).toBe(false)
  })

  it('retry resets the preview: clear then start again with empty text', () => {
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'rewrite' })),
    )
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('first attempt')),
    )
    // Retry = clear + start the same range/action again.
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiClearMeta()))
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'rewrite' })),
    )
    const s = previewState(state)
    expect(s.active).toBe(true)
    expect(s.text).toBe('')
    expect(s.from).toBe(1)
    expect(s.to).toBe(6)
  })
})
