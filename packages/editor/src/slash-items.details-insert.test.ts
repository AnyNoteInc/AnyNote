// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSlashItems, type SlashMediaHandlers } from './slash-items'

// Regression test for the «Переключатель» slash command: Tiptap's insertContent
// places the caret at the END of the inserted content (bias -1), which resolves
// into detailsContent's empty paragraph — DOM that the Details node view mounts
// with the `hidden` attribute and un-hides only a macrotask later. The caret
// therefore lands in invisible content and typing goes nowhere near the title.
// The slash item must instead select the seeded «Заголовок» summary text so the
// first keystroke replaces it (mirrors the library's own setDetails, which ends
// with an explicit setTextSelection into the summary).

const handlers: SlashMediaHandlers = {
  openDatePopover: vi.fn(),
  openDatetimePopover: vi.fn(),
  openFilePopover: vi.fn(),
  openMediaPopover: vi.fn(),
  openMarkdownPopover: vi.fn(),
  openPageLinkPopover: vi.fn(),
  openBookmarkPopover: vi.fn(),
  openEmbedPopover: vi.fn(),
}

const detailsItem = () => {
  const item = createSlashItems(handlers)('переключатель').find((it) => it.id === 'details')
  if (!item) throw new Error('details slash item not found')
  return item
}

// Same Details configuration as buildExtensions() (persist: true is load-bearing:
// without it the `open` attribute is dropped from the schema entirely).
const makeEditor = (content: string) => {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Details.configure({ persist: true, HTMLAttributes: { class: 'anynote-details' } }),
      DetailsSummary.configure({ HTMLAttributes: { class: 'anynote-details__summary' } }),
      DetailsContent.configure({ HTMLAttributes: { class: 'anynote-details__content' } }),
    ],
  })
}

// Both Tiptap's mount() focus and the Details node view queue setTimeout(0)
// macrotasks; drain one tick so they run while happy-dom's `document` still
// exists (see paste-precedence.test.tsx for the full story).
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('details slash command cursor placement', () => {
  it('selects the summary title after inserting into an empty paragraph', () => {
    const editor = makeEditor('<p>/</p>')

    detailsItem().run({ editor, range: { from: 1, to: 2 } })

    const { selection, doc } = editor.state
    expect(selection.$from.parent.type.name).toBe('detailsSummary')
    expect(doc.textBetween(selection.from, selection.to)).toBe('Заголовок')

    editor.destroy()
  })

  it('selects the summary title when the paragraph has trailing text', () => {
    const editor = makeEditor('<p>/хвост</p>')

    detailsItem().run({ editor, range: { from: 1, to: 2 } })

    const { selection, doc } = editor.state
    expect(selection.$from.parent.type.name).toBe('detailsSummary')
    expect(doc.textBetween(selection.from, selection.to)).toBe('Заголовок')

    editor.destroy()
  })
})
