// @vitest-environment happy-dom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it, vi } from 'vitest'

import { AudioSchema } from './audio.schema'
import { buildFileUpload } from './file-upload'
import { FileAttachmentSchema } from './file-attachment.schema'
import { VideoSchema } from './video.schema'
import type { UploadHandler } from '../types'

// The schema-only variants give us the `video`/`audio`/`fileAttachment` nodes
// without pulling in their React node views (no DOM rendering needed here — we
// only assert which node type the plugin inserts).
const noopUpload: UploadHandler = vi.fn(async () => ({ id: 'x', src: '/api/files/x' }))

const makeEditor = () => {
  const element = document.createElement('div')
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      VideoSchema,
      AudioSchema,
      FileAttachmentSchema,
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
