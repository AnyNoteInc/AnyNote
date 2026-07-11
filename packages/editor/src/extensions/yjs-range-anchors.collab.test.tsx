// @vitest-environment happy-dom
// Regression tests for the Yjs half of the range drift guards. y-prosemirror
// applies EVERY remote update as ONE whole-document ReplaceStep
// (sync-plugin _typeChanged: tr.replace(0, doc.content.size, …)) — mapping an
// interior range through that step corrupts it to [0, docEnd]. Both range
// plugins (ChatContextHighlight and InlineAI) therefore anchor their range as
// Yjs RelativePositions and re-RESOLVE them on ySync transactions.
//
// Setup: two live editors bound to the SAME Y.Doc — an edit in editor B lands
// in editor A as a genuine remote ySync transaction, exactly like a
// collaborator's (or the page-chat agent's engines-side) write.

import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'
import { afterEach, describe, expect, it } from 'vitest'

import { ChatContextHighlight, chatContextHighlightPluginKey } from './chat-context-highlight'
import { getInlineAiPreview, startInlineAiPreview, InlineAI } from './inline-ai'

let editors: Editor[] = []

const makeCollabPair = () => {
  const ydoc = new Y.Doc()
  const make = () =>
    new Editor({
      extensions: [
        // The production config: StarterKit undo off, Yjs owns the doc.
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: ydoc, field: 'default' }),
        ChatContextHighlight,
        InlineAI,
      ],
    })
  const a = make()
  const b = make()
  editors.push(a, b)
  return { a, b }
}

afterEach(() => {
  for (const e of editors) e.destroy()
  editors = []
})

describe('remote Yjs updates (whole-doc ReplaceStep) do not corrupt held ranges', () => {
  it('ChatContextHighlight survives a collaborator/agent edit elsewhere in the doc', () => {
    const { a, b } = makeCollabPair()
    a.commands.setContent('<p>Hello world</p>')
    expect(b.state.doc.textContent).toBe('Hello world')

    // Highlight "Hello" (1..6) in A — the page-chat context.
    a.commands.setChatContextHighlight({ from: 1, to: 6 })

    // A remote write lands BELOW the selection (the agent's appendToPage).
    b.commands.insertContentAt(b.state.doc.content.size, '<p>agent paragraph</p>')
    expect(a.state.doc.textContent).toContain('agent paragraph')

    const range = chatContextHighlightPluginKey.getState(a.state)
    expect(range).not.toBeNull()
    // NOT the whole document — still exactly the held fragment.
    expect(a.state.doc.textBetween(range!.from, range!.to)).toBe('Hello')
  })

  it('ChatContextHighlight clears (not whole-page-paints) when the anchored text is deleted remotely', () => {
    const { a, b } = makeCollabPair()
    a.commands.setContent('<p>Hello world</p><p>tail</p>')
    a.commands.setChatContextHighlight({ from: 1, to: 6 })

    // The collaborator deletes the paragraph holding the highlight.
    b.commands.deleteRange({ from: 0, to: 13 })

    const range = chatContextHighlightPluginKey.getState(a.state)
    // Orphaned anchors → cleared; a stale [0,docEnd] paint would be a bug.
    if (range) {
      expect(range.to - range.from).toBeLessThanOrEqual(1)
    }
  })

  it('InlineAI preview range survives a remote edit while streaming', () => {
    const { a, b } = makeCollabPair()
    a.commands.setContent('<p>Hello world</p>')

    startInlineAiPreview(a, { from: 1, to: 6, action: 'rewrite' })

    // Remote write below the pending range mid-stream.
    b.commands.insertContentAt(b.state.doc.content.size, '<p>agent paragraph</p>')

    const preview = getInlineAiPreview(a)
    expect(preview.active).toBe(true)
    expect(a.state.doc.textBetween(preview.from, preview.to)).toBe('Hello')
  })
})
