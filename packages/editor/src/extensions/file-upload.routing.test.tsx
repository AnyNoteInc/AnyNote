// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AudioSchema } from './audio.schema'
import { buildFileUpload } from './file-upload'
import { buildImagePaste } from './image-paste'
import { FileAttachmentSchema } from './file-attachment.schema'
import { VideoSchema } from './video.schema'
import type { UploadHandler } from '../types'

// The schema-only variants give us the `video`/`audio`/`fileAttachment` nodes
// without pulling in their React node views (no DOM rendering needed here — we
// only assert which node type the plugin inserts).
const noopUpload: UploadHandler = vi.fn(async () => ({ id: 'x', src: '/api/files/x' }))

const makeEditor = (extraExtensions: object[] = []) => {
  const element = document.createElement('div')
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      VideoSchema,
      AudioSchema,
      FileAttachmentSchema,
      buildFileUpload(noopUpload),
      ...(extraExtensions as never[]),
    ],
  })
}

const pasteFiles = (editor: Editor, files: File[]) => {
  const clipboardData = {
    files,
    getData: () => '',
    types: [] as string[],
  } as unknown as DataTransfer
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })
  editor.view.dom.dispatchEvent(event)
}

const pasteFile = (editor: Editor, file: File) => pasteFiles(editor, [file])

const nodeNames = (editor: Editor): string[] => {
  const names: string[] = []
  editor.state.doc.descendants((node) => {
    names.push(node.type.name)
    return undefined
  })
  return names
}

// Tiptap's `mount()` schedules a `setTimeout(0)` that runs `commands.focus()`.
// Each test destroys its editor synchronously (so the callback no-ops via the
// `isDestroyed` guard), but the macrotask itself stays queued at the OS level.
// Under heavy parallel `pnpm gates` load it can fire AFTER this file's happy-dom
// environment is torn down — `document` is gone and ProseMirror's deferred
// `selectionToDOM` throws `ReferenceError: document is not defined`, failing the
// run despite all assertions passing. Draining one macrotask tick here lets the
// (already-guarded) callback run while `document` still exists.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('fileUpload paste routing (synchronous placeholder)', () => {
  it('inserts a `video` placeholder for a video/* paste', () => {
    const editor = makeEditor()
    try {
      pasteFile(editor, new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' }))
      expect(nodeNames(editor)).toContain('video')
    } finally {
      editor.destroy()
    }
  })

  it('inserts an `audio` placeholder for an audio/* paste', () => {
    const editor = makeEditor()
    try {
      pasteFile(editor, new File([new Uint8Array([1])], 'song.mp3', { type: 'audio/mpeg' }))
      expect(nodeNames(editor)).toContain('audio')
    } finally {
      editor.destroy()
    }
  })

  it('inserts a `fileAttachment` placeholder for a non-media paste', () => {
    const editor = makeEditor()
    try {
      pasteFile(editor, new File(['hello'], 'note.txt', { type: 'text/plain' }))
      const names = nodeNames(editor)
      expect(names).toContain('fileAttachment')
      expect(names).not.toContain('video')
      expect(names).not.toContain('audio')
    } finally {
      editor.destroy()
    }
  })

  it('ignores an image/* paste (left to the image-paste plugin)', () => {
    const editor = makeEditor()
    try {
      pasteFile(editor, new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }))
      const names = nodeNames(editor)
      expect(names).not.toContain('video')
      expect(names).not.toContain('fileAttachment')
    } finally {
      editor.destroy()
    }
  })
})

describe('mixed clipboard (images + other files in one paste)', () => {
  it('routes images to the image node AND the rest to fileAttachment', () => {
    // Both plugins mounted, like the real editor; base Image gives the schema
    // node without the React view.
    const editor = makeEditor([Image, buildImagePaste(noopUpload)])
    try {
      pasteFiles(editor, [
        new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }),
        new File(['hello'], 'note.txt', { type: 'text/plain' }),
      ])
      const names = nodeNames(editor)
      expect(names).toContain('image')
      // The non-image file must NOT be silently dropped.
      expect(names).toContain('fileAttachment')
    } finally {
      editor.destroy()
    }
  })
})
