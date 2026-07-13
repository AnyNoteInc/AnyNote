// @vitest-environment happy-dom
// Editor-level accept tests: the pure suite (inline-ai.test.ts) pins WHERE the
// accept lands (resolveInlineAiAcceptTarget); this one pins WHAT lands — the
// streamed answer is parsed as MARKDOWN (markdownToHtml → insertContentAt, the
// SpaceAiBar precedent), so `**жирный**` becomes <strong>, lists become <ul>,
// and the raw `**` never reaches the doc. Needs a real Editor (+DOM): Tiptap
// parses the HTML through the schema.

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import {
  InlineAI,
  applyInlineAiResult,
  appendInlineAiToken,
  finishInlineAiPreview,
  getInlineAiPreview,
  startInlineAiPreview,
  stripMarkdownFence,
} from './inline-ai'

let editor: Editor | null = null

const makeEditor = (content: string): Editor => {
  editor = new Editor({
    extensions: [StarterKit, InlineAI],
    content,
  })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

const streamAndFinish = (
  ed: Editor,
  args: { from: number; to: number; action: string },
  text: string,
) => {
  startInlineAiPreview(ed, args)
  appendInlineAiToken(ed, text)
  finishInlineAiPreview(ed)
}

describe('applyInlineAiResult parses the answer as markdown', () => {
  it('replace: **bold** markdown lands as a <strong> node, not literal asterisks', () => {
    // doc: <p>Hello world</p>, preview over "Hello" (1..6).
    const ed = makeEditor('<p>Hello world</p>')
    streamAndFinish(ed, { from: 1, to: 6, action: 'rewrite' }, '**Привет**')

    expect(applyInlineAiResult(ed)).toBe(true)
    expect(ed.state.doc.textContent).toBe('Привет world')
    expect(ed.getHTML()).toContain('<strong>Привет</strong>')
    expect(ed.getHTML()).not.toContain('**')
    // Preview cleared atomically with the insert.
    expect(getInlineAiPreview(ed).active).toBe(false)
  })

  it('insertBelow: a markdown list lands as a real <ul> after the block', () => {
    const ed = makeEditor('<p>Привет мир</p>')
    streamAndFinish(ed, { from: 1, to: 11, action: 'rewrite' }, '- один\n- два')

    expect(applyInlineAiResult(ed, 'insertBelow')).toBe(true)
    // Original paragraph untouched, list appended below.
    expect(ed.state.doc.child(0).textContent).toBe('Привет мир')
    expect(ed.getHTML()).toContain('<ul')
    expect(ed.state.doc.textContent).toContain('один')
    expect(ed.state.doc.textContent).toContain('два')
    expect(getInlineAiPreview(ed).active).toBe(false)
  })

  it('expand: appends after the selection, original intact', () => {
    const ed = makeEditor('<p>Hello world</p>')
    streamAndFinish(ed, { from: 1, to: 6, action: 'expand' }, 'и ещё')

    expect(applyInlineAiResult(ed)).toBe(true)
    expect(ed.state.doc.textContent).toContain('Hello')
    expect(ed.state.doc.textContent).toContain('и ещё')
    expect(getInlineAiPreview(ed).active).toBe(false)
  })

  it('replace inside a code block: a fenced answer lands as code text, no literal backticks', () => {
    // The block Ask-AI case: the captured range is the code block's INNER
    // content; models wrap code answers in ```sql fences despite the system
    // prompt. The fence characters must never reach the doc, the container
    // must stay ONE code block (не «новый блок рядом + пустой остаток»), and
    // its language attr must survive.
    const ed = makeEditor('<pre><code class="language-plantuml">@startuml\nrest\n@enduml</code></pre>')
    const inner = { from: 1, to: ed.state.doc.child(0).nodeSize - 1 }
    streamAndFinish(
      ed,
      { ...inner, action: 'custom' },
      '```plantuml\n@startuml\nrest/trpc\n@enduml\n```',
    )

    expect(applyInlineAiResult(ed)).toBe(true)
    // Ровно один code-блок: замена НА МЕСТЕ, а не «новый сосед + пустой
    // остаток». (StarterKit trailingNode добавляет пустой параграф — не блок.)
    const codeBlocks: string[] = []
    ed.state.doc.forEach((n) => {
      if (n.type.name === 'codeBlock') codeBlocks.push(n.textContent)
    })
    expect(codeBlocks).toHaveLength(1)
    expect(ed.state.doc.child(0).type.name).toBe('codeBlock')
    expect(ed.state.doc.child(0).attrs.language).toBe('plantuml')
    expect(ed.state.doc.textContent).toContain('rest/trpc')
    expect(ed.state.doc.textContent).not.toContain('rest\n@enduml\n')
    expect(ed.state.doc.textContent).not.toContain('```')
    expect(getInlineAiPreview(ed).active).toBe(false)
  })

  it('no-op when no preview is active', () => {
    const ed = makeEditor('<p>Hello</p>')
    expect(applyInlineAiResult(ed)).toBe(false)
    expect(ed.state.doc.textContent).toBe('Hello')
  })
})

describe('stripMarkdownFence', () => {
  it('unwraps a whole-answer fence with a language tag', () => {
    expect(stripMarkdownFence('```plantuml\n@startuml\nA -> B\n@enduml\n```')).toBe(
      '@startuml\nA -> B\n@enduml',
    )
  })

  it('unwraps a bare fence without a language', () => {
    expect(stripMarkdownFence('```\ncode\n```')).toBe('code')
  })

  it('leaves a mixed prose+fence answer untouched (aside from trim)', () => {
    const mixed = 'Вот диаграмма:\n```plantuml\nA -> B\n```'
    expect(stripMarkdownFence(mixed)).toBe(mixed)
  })

  it('leaves plain text untouched', () => {
    expect(stripMarkdownFence('  SELECT 1;  ')).toBe('SELECT 1;')
  })
})
