// @vitest-environment happy-dom
// Unit tests for the shared placeholder-first upload insertion (upload-insert.ts):
// the routines behind image/file paste AND the drop path. Uses a schema-only
// image extension mirroring ResizableImage's attrs (no React node view needed).

import { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileAttachmentSchema } from './file-attachment.schema'
import { insertFileUploads, insertImageUploads } from './upload-insert'
import type { UploadHandler } from '../types'

const ImageSchemaOnly = Image.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      uploadId: { default: null, rendered: false },
      name: { default: null },
      size: { default: null },
      mimeType: { default: null },
    }
  },
})

const makeEditor = (withImage = true) => {
  const element = document.createElement('div')
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      ...(withImage ? [ImageSchemaOnly] : []),
      FileAttachmentSchema,
    ],
  })
}

const flushUploads = async () => {
  // The upload promise chain settles within a microtask for the fakes below;
  // one macrotask tick is plenty (and drains Tiptap's mount() focus timer too).
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const findNode = (editor: Editor, name: string) => {
  let found: { attrs: Record<string, unknown> } | null = null
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === name) found = node
    return undefined
  })
  return found as { attrs: Record<string, unknown> } | null
}

afterEach(async () => {
  await flushUploads()
})

describe('insertImageUploads', () => {
  it('inserts a placeholder synchronously, then fills src + file metadata', async () => {
    const editor = makeEditor()
    try {
      const upload: UploadHandler = vi.fn(async () => ({ id: 'f1', src: '/api/files/f1' }))
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })

      expect(insertImageUploads(editor.view, upload, [file])).toBe(true)
      // Placeholder is in the doc BEFORE the upload settles.
      expect(findNode(editor, 'image')?.attrs.src).toBeNull()

      await flushUploads()
      const image = findNode(editor, 'image')!
      expect(image.attrs.src).toBe('/api/files/f1')
      expect(image.attrs.name).toBe('shot.png')
      expect(image.attrs.size).toBe(3)
      expect(image.attrs.mimeType).toBe('image/png')
      expect(image.attrs.uploadId).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it('removes the placeholder when the upload fails', async () => {
    const editor = makeEditor()
    try {
      const upload: UploadHandler = vi.fn(async () => {
        throw new Error('quota')
      })
      const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
      insertImageUploads(editor.view, upload, [file])
      expect(findNode(editor, 'image')).not.toBeNull()

      await flushUploads()
      expect(findNode(editor, 'image')).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it('returns false when the schema has no image node', () => {
    const editor = makeEditor(false)
    try {
      const upload: UploadHandler = vi.fn(async () => ({ id: 'x', src: '/x' }))
      const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
      expect(insertImageUploads(editor.view, upload, [file])).toBe(false)
      expect(upload).not.toHaveBeenCalled()
    } finally {
      editor.destroy()
    }
  })
})

describe('insertFileUploads', () => {
  it('fills url/name/size/mimeType/ext on the attachment after upload', async () => {
    const editor = makeEditor()
    try {
      const upload: UploadHandler = vi.fn(async () => ({ id: 'f2', src: '/api/files/f2' }))
      const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
      expect(insertFileUploads(editor.view, upload, [file])).toBe(true)

      await flushUploads()
      const attachment = findNode(editor, 'fileAttachment')!
      expect(attachment.attrs.url).toBe('/api/files/f2')
      expect(attachment.attrs.name).toBe('note.txt')
      expect(attachment.attrs.mimeType).toBe('text/plain')
      expect(attachment.attrs.ext).toBe('txt')
      expect(attachment.attrs.uploadId).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it('removes the placeholder when the upload fails', async () => {
    const editor = makeEditor()
    try {
      const upload: UploadHandler = vi.fn(async () => {
        throw new Error('quota')
      })
      insertFileUploads(editor.view, upload, [new File(['x'], 'a.txt', { type: 'text/plain' })])
      expect(findNode(editor, 'fileAttachment')).not.toBeNull()

      await flushUploads()
      expect(findNode(editor, 'fileAttachment')).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it('returns false for an empty file list', () => {
    const editor = makeEditor()
    try {
      const upload: UploadHandler = vi.fn(async () => ({ id: 'x', src: '/x' }))
      expect(insertFileUploads(editor.view, upload, [])).toBe(false)
    } finally {
      editor.destroy()
    }
  })
})
