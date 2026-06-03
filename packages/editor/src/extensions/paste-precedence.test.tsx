// @vitest-environment happy-dom
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it, vi } from 'vitest'

import { buildFileUpload } from './file-upload'
import { buildImagePaste } from './image-paste'
import type { UploadHandler } from '../types'

// Regression test for the real-editor paste precedence bug: `buildImagePaste`
// and `buildFileUpload` both register a `handlePaste` ProseMirror plugin.
// ProseMirror runs paste handlers in plugin order and stops at the first that
// returns true. Tiptap collects plugins from `[...extensions].reverse()`, so
// with equal priority `fileUpload` ran BEFORE `imagePaste` and swallowed image
// pastes into its own `uploadImage` node — never reaching our `image` node.
//
// The isolated image-paste.test.ts can't catch this: it exercises the plugin
// alone, so there is nothing to lose precedence to. We need a real Editor with
// both extensions to observe the ordering.

// A minimal stand-in for ResizableImage: same node name + `src` attr, no React
// node view (avoids DOM rendering). This isolates the variable under test —
// plugin precedence — from ResizableImage's view machinery.
const StubImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes: () => ({ src: { default: null } }),
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
})

const noopUpload: UploadHandler = vi.fn(async () => ({ id: 'x', src: 'https://cdn/x.png' }))

const makeEditor = () => {
  const element = document.createElement('div')
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      StubImage,
      // Same declaration order as buildExtensions(): imagePaste before fileUpload.
      buildImagePaste(noopUpload),
      buildFileUpload(noopUpload),
    ],
  })
}

const pasteFile = (editor: Editor, file: File) => {
  const clipboardData = {
    files: [file],
    getData: () => '',
    types: [] as string[],
  } as unknown as DataTransfer
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })
  editor.view.dom.dispatchEvent(event)
}

const nodeNames = (editor: Editor): string[] => {
  const names: string[] = []
  editor.state.doc.descendants((node) => {
    names.push(node.type.name)
    return undefined
  })
  return names
}

describe('paste precedence (imagePaste vs fileUpload)', () => {
  it('routes a pasted image to the `image` node, not fileUpload `uploadImage`', () => {
    const editor = makeEditor()
    try {
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
      pasteFile(editor, file)
      const names = nodeNames(editor)
      expect(names).toContain('image')
      expect(names).not.toContain('uploadImage')
    } finally {
      editor.destroy()
    }
  })

  it('leaves a non-image paste to fileUpload (inserts uploadFileCard, not image)', () => {
    const editor = makeEditor()
    try {
      const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
      pasteFile(editor, file)
      const names = nodeNames(editor)
      expect(names).not.toContain('image')
    } finally {
      editor.destroy()
    }
  })
})
