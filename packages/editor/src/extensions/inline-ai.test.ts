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
import type { Decoration, DecorationSet } from '@tiptap/pm/view'

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

/** Pull the plugin's decoration set for a state (via its `decorations` prop). */
const decorationsFor = (state: EditorState): DecorationSet => {
  const decorate = inlineAiPlugin.props?.decorations
  if (!decorate) throw new Error('decorations prop missing')
  return decorate.call(inlineAiPlugin, state) as DecorationSet
}

/** The streaming-preview WIDGET decoration carries a `spec.key`; the source
 *  inline decoration does not — so the widget is the one with a string key. */
const widgetKeyFor = (state: EditorState): string | undefined => {
  const set = decorationsFor(state)
  const all = set.find() as Decoration[]
  const widget = all.find((d) => typeof d.spec?.key === 'string')
  return widget?.spec?.key as string | undefined
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

describe('streaming-preview widget decoration key (no per-token DOM thrash)', () => {
  it('keeps a STABLE widget key across appended tokens while text accumulates', () => {
    // The widget key must NOT change per token, or ProseMirror's view diff
    // (WidgetType.eq is key-equality) tears down + rebuilds the widget DOM each
    // token — which would destroy+remount the Task 4 React toolbar per token.
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'summarize' })),
    )
    const keys: Array<string | undefined> = [widgetKeyFor(state)]
    for (const token of ['Прив', 'ет', ', ', 'мир']) {
      state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta(token)))
      keys.push(widgetKeyFor(state))
    }
    // The text accumulated across the tokens...
    expect(previewState(state).text).toBe('Привет, мир')
    // ...but the widget key stayed identical for every one of them.
    expect(keys.every((k) => k === keys[0])).toBe(true)
    expect(keys[0]).toBe('inline-ai:streaming')
  })

  it('flips the widget key only on a discrete status transition (streaming → done)', () => {
    let state = stateFrom('Hello world')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 6, action: 'rewrite' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('done')))
    expect(widgetKeyFor(state)).toBe('inline-ai:streaming')
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiFinishMeta()))
    expect(widgetKeyFor(state)).toBe('inline-ai:done')
  })
})

describe('insertBelow apply mode', () => {
  it('inserts the result as a new paragraph after the selection block, keeping the original', () => {
    let state = stateFrom('Привет мир')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 11, action: 'rewrite' })),
    )
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Новый абзац')),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiFinishMeta()))

    const tr = buildInlineAiAcceptTransaction(state, 'insertBelow')
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)
    expect(next.doc.childCount).toBe(2)
    expect(next.doc.child(0).textContent).toBe('Привет мир')
    expect(next.doc.child(1).textContent).toBe('Новый абзац')
    // Preview cleared atomically in the same transaction.
    expect(inlineAiPluginKey.getState(next)?.active).toBe(false)
  })

  it('replace mode is the default and unchanged', () => {
    let state = stateFrom('Привет мир')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 11, action: 'rewrite' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Замена')))
    const next = state.apply(buildInlineAiAcceptTransaction(state)!)
    expect(next.doc.childCount).toBe(1)
    expect(next.doc.child(0).textContent).toBe('Замена')
  })

  it('insertBelow lands after the selection block, not at doc end (multi-block)', () => {
    const doc = schema.nodes.doc.create(null, [para('Привет мир'), para('хвост')])
    let state = EditorState.create({ schema, doc, plugins: [inlineAiPlugin] })
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 11, action: 'rewrite' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Вставка')))
    const next = state.apply(buildInlineAiAcceptTransaction(state, 'insertBelow')!)
    expect(next.doc.childCount).toBe(3)
    expect(next.doc.child(0).textContent).toBe('Привет мир')
    expect(next.doc.child(1).textContent).toBe('Вставка')
    expect(next.doc.child(2).textContent).toBe('хвост')
  })
})
