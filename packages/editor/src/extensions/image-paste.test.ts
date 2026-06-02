import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ResizableImage } from './resizable-image'
import { buildImagePaste } from './image-paste'

// The editor package's vitest runs in a node env (no DOM), so we exercise the
// plugin's handlePaste against a headless fake view: a real EditorState plus a
// dispatch that applies transactions. handlePaste only reads view.state /
// view.state.schema and calls view.dispatch — no DOM is needed.

type Resolver = { resolve: (src: string) => void; reject: (e: unknown) => void }

const makeUpload = () => {
  const calls: Resolver[] = []
  const handler = vi.fn(
    () =>
      new Promise<{ id: string; src: string }>((resolve, reject) => {
        calls.push({ resolve: (src) => resolve({ id: 'x', src }), reject })
      }),
  )
  return { handler, calls }
}

const imageFile = (name = 'shot.png') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
const textFile = () => new File(['hello'], 'note.txt', { type: 'text/plain' })

const schema = getSchema([StarterKit, ResizableImage.configure({ uploadHandler: null })])

const getPastePlugin = (uploadHandler: ReturnType<typeof makeUpload>['handler']) => {
  const plugins = buildImagePaste(uploadHandler).config.addProseMirrorPlugins!.call({
    editor: {},
  } as never) as Plugin[]
  return plugins[0]!
}

// Minimal stand-in for EditorView that handlePaste actually touches.
class FakeView {
  state: EditorState
  constructor(state: EditorState) {
    this.state = state
  }
  dispatch = (tr: import('@tiptap/pm/state').Transaction) => {
    this.state = this.state.apply(tr)
  }
}

const mount = (content: Parameters<typeof schema.node>[2], selFrom: number) => {
  const upload = makeUpload()
  const plugin = getPastePlugin(upload.handler)
  const doc = schema.node('doc', null, content)
  let state = EditorState.create({ schema, doc, plugins: [plugin] })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, selFrom)))
  const view = new FakeView(state)
  return { view, upload, plugin }
}

const fakePasteEvent = (files: File[]) => {
  let prevented = false
  const event = {
    clipboardData: { files },
    preventDefault: () => {
      prevented = true
    },
  } as unknown as ClipboardEvent
  return { event, isPrevented: () => prevented }
}

const paste = (
  ctx: ReturnType<typeof mount>,
  files: File[],
): { handled: boolean; prevented: boolean } => {
  const { event, isPrevented } = fakePasteEvent(files)
  const handlePaste = ctx.plugin.props.handlePaste as (
    view: EditorView,
    e: ClipboardEvent,
  ) => boolean
  const handled = handlePaste(ctx.view as unknown as EditorView, event)
  return { handled: Boolean(handled), prevented: isPrevented() }
}

const images = (view: FakeView) => {
  const out: { pos: number; src: unknown }[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image') out.push({ pos, src: node.attrs.src })
    return undefined
  })
  return out
}

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve()
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('buildImagePaste', () => {
  it('ignores a non-image paste so other handlers run', () => {
    const ctx = mount([schema.node('paragraph')], 1)
    const { handled, prevented } = paste(ctx, [textFile()])
    expect(handled).toBe(false)
    expect(prevented).toBe(false)
    expect(images(ctx.view)).toHaveLength(0)
  })

  it('inserts a placeholder then fills its src on a blank line', async () => {
    const ctx = mount([schema.node('paragraph')], 1)
    const { handled, prevented } = paste(ctx, [imageFile()])
    expect(handled).toBe(true)
    expect(prevented).toBe(true)
    const placed = images(ctx.view)
    expect(placed).toHaveLength(1)
    expect(placed[0]!.src).toBeNull()
    const pos = placed[0]!.pos
    ctx.upload.calls[0]!.resolve('https://cdn/shot.png')
    await flush()
    expect(images(ctx.view)).toEqual([{ pos, src: 'https://cdn/shot.png' }])
  })

  it('fills the right node when pasting mid-text', async () => {
    const ctx = mount([schema.node('paragraph', null, [schema.text('hello')])], 3)
    paste(ctx, [imageFile()])
    const before = images(ctx.view)
    expect(before).toHaveLength(1)
    expect(before[0]!.src).toBeNull()
    ctx.upload.calls[0]!.resolve('https://cdn/mid.png')
    await flush()
    const after = images(ctx.view)
    expect(after).toHaveLength(1)
    expect(after[0]!.src).toBe('https://cdn/mid.png')
  })

  it('gives each image its own src when two are pasted at once', async () => {
    const ctx = mount([schema.node('paragraph')], 1)
    paste(ctx, [imageFile('a.png'), imageFile('b.png')])
    expect(images(ctx.view)).toHaveLength(2)
    expect(ctx.upload.calls).toHaveLength(2)
    // resolve in reverse order to stress id-based (not first-match) targeting
    ctx.upload.calls[1]!.resolve('https://cdn/b.png')
    ctx.upload.calls[0]!.resolve('https://cdn/a.png')
    await flush()
    const srcs = images(ctx.view)
      .map((i) => String(i.src))
      .sort((a, b) => a.localeCompare(b))
    expect(srcs).toEqual(['https://cdn/a.png', 'https://cdn/b.png'])
  })

  it('removes the placeholder when the upload fails', async () => {
    const ctx = mount([schema.node('paragraph')], 1)
    paste(ctx, [imageFile()])
    expect(images(ctx.view)).toHaveLength(1)
    ctx.upload.calls[0]!.reject(new Error('boom'))
    await flush()
    expect(images(ctx.view)).toHaveLength(0)
  })
})
