// @vitest-environment happy-dom
// Pins the drag-handle «Спросить AI» capture: the INNER block range (container
// survives the accept-replace), the block text as model context, and the null
// gates for blocks with nothing to transform.

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { blockAskAiCapture } from './block-ask-ai'

let editor: Editor | null = null

// StarterKit already bundles HorizontalRule (the atom-leaf case below).
const makeEditor = (content: string): Editor => {
  editor = new Editor({ extensions: [StarterKit], content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('blockAskAiCapture', () => {
  it('captures the inner range and text of a paragraph', () => {
    const ed = makeEditor('<p>Привет мир</p><p>второй</p>')
    // First top-level block starts at pos 0.
    const captured = blockAskAiCapture(ed, 0)
    expect(captured).not.toBeNull()
    expect(captured!.from).toBe(1)
    // <p>Привет мир</p> nodeSize = 12 → inner end = 11.
    expect(captured!.to).toBe(ed.state.doc.child(0).nodeSize - 1)
    expect(captured!.selectedText).toBe('Привет мир')
    expect(captured!.anchorEl).not.toBeNull()
  })

  it('captures the second block at its own position', () => {
    const ed = makeEditor('<p>раз</p><p>два</p>')
    const secondPos = ed.state.doc.child(0).nodeSize
    const captured = blockAskAiCapture(ed, secondPos)
    expect(captured).not.toBeNull()
    expect(captured!.selectedText).toBe('два')
    expect(captured!.from).toBe(secondPos + 1)
  })

  it('keeps the container when the captured range is accept-replaced', () => {
    const ed = makeEditor('<h2>Заголовок текст</h2>')
    const captured = blockAskAiCapture(ed, 0)!
    ed.commands.insertContentAt({ from: captured.from, to: captured.to }, 'Новый')
    expect(ed.getHTML()).toContain('<h2>Новый</h2>')
  })

  it('spans nested content for a list block', () => {
    const ed = makeEditor('<ul><li><p>один</p></li><li><p>два</p></li></ul>')
    const captured = blockAskAiCapture(ed, 0)
    expect(captured).not.toBeNull()
    expect(captured!.selectedText).toContain('один')
    expect(captured!.selectedText).toContain('два')
  })

  it('returns null for an empty paragraph', () => {
    const ed = makeEditor('<p></p>')
    expect(blockAskAiCapture(ed, 0)).toBeNull()
  })

  it('returns null for an atom leaf block (horizontal rule)', () => {
    const ed = makeEditor('<p>текст</p><hr>')
    const hrPos = ed.state.doc.child(0).nodeSize
    expect(ed.state.doc.resolve(hrPos).nodeAfter?.type.name).toBe('horizontalRule')
    expect(blockAskAiCapture(ed, hrPos)).toBeNull()
  })

  it('returns null when pos points past the document', () => {
    const ed = makeEditor('<p>текст</p>')
    expect(blockAskAiCapture(ed, ed.state.doc.content.size)).toBeNull()
  })
})
