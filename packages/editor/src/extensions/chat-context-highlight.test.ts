// @vitest-environment happy-dom
// The page-chat context highlight: the sidebar drives setChatContextHighlight
// while the panel is open so the selection stays VISIBLE after the composer
// steals focus. Editor-level (not bare-plugin) because the command surface is
// the contract apps/web consumes.

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { Decoration, DecorationSet } from '@tiptap/pm/view'
import { afterEach, describe, expect, it } from 'vitest'

import { ChatContextHighlight, chatContextHighlightPluginKey } from './chat-context-highlight'

let editor: Editor | null = null

const makeEditor = (content: string): Editor => {
  editor = new Editor({ extensions: [StarterKit, ChatContextHighlight], content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

const currentRange = (ed: Editor) => chatContextHighlightPluginKey.getState(ed.state) ?? null

const paintedDecos = (ed: Editor): Decoration[] => {
  const plugin = ed.state.plugins.find((p) => p.spec.key === chatContextHighlightPluginKey)
  if (!plugin?.props.decorations) return []
  // The plugin always builds a DecorationSet (see chat-context-highlight.ts).
  const set = plugin.props.decorations.call(plugin, ed.state) as DecorationSet | null | undefined
  return set ? set.find() : []
}

describe('ChatContextHighlight', () => {
  it('set paints the range; null clears it', () => {
    const ed = makeEditor('<p>Hello world</p>')
    ed.commands.setChatContextHighlight({ from: 1, to: 6 })
    expect(currentRange(ed)).toEqual({ from: 1, to: 6 })
    expect(paintedDecos(ed)).toHaveLength(1)

    ed.commands.setChatContextHighlight(null)
    expect(currentRange(ed)).toBeNull()
    expect(paintedDecos(ed)).toHaveLength(0)
  })

  it('drift-guards the range through edits before it', () => {
    const ed = makeEditor('<p>Hello world</p>')
    ed.commands.setChatContextHighlight({ from: 1, to: 6 })
    ed.commands.insertContentAt(1, 'XYZ')
    expect(currentRange(ed)).toEqual({ from: 4, to: 9 })
    expect(ed.state.doc.textBetween(4, 9)).toBe('Hello')
  })

  it('drops (not throws) a range that fell outside the doc', () => {
    const ed = makeEditor('<p>Hello world</p>')
    ed.commands.setChatContextHighlight({ from: 1, to: 999 })
    expect(paintedDecos(ed)).toHaveLength(0)
  })

  it('same-range set is a no-op (no extra transaction)', () => {
    const ed = makeEditor('<p>Hello world</p>')
    ed.commands.setChatContextHighlight({ from: 1, to: 6 })
    let transactions = 0
    ed.on('transaction', () => {
      transactions += 1
    })
    ed.commands.setChatContextHighlight({ from: 1, to: 6 })
    expect(currentRange(ed)).toEqual({ from: 1, to: 6 })
    expect(transactions).toBe(0)
  })
})
