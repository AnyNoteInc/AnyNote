// @vitest-environment happy-dom
// Unit tests for the shared placeholder-first upload insertion (upload-insert.ts):
// the routines behind image/file paste AND the drop path. Uses a schema-only
// image extension mirroring ResizableImage's attrs (no React node view needed).

import { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
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

  it('pasting over a still-pending placeholder does not steal its uploadId', async () => {
    const editor = makeEditor()
    try {
      // First paste never resolves — the placeholder stays pending (src=null).
      let resolveFirst: (r: { id: string; src: string }) => void = () => {}
      const first: UploadHandler = () =>
        new Promise((res) => {
          resolveFirst = res
        })
      insertImageUploads(editor.view, first, [
        new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
      ])
      const pending = findNodePos(editor, 'image')!
      // NodeSelect the pending blank placeholder, then paste a second image over it.
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pending.pos)),
      )
      const second: UploadHandler = async () => ({ id: 'b', src: '/api/files/b' })
      insertImageUploads(editor.view, second, [
        new File([new Uint8Array([2])], 'b.png', { type: 'image/png' }),
      ])
      await flushUploads()

      // Both placeholders survive as distinct nodes: the pending one keeps its
      // own id (still src=null), the new one resolved to its own src.
      const images: Array<{ src: unknown; uploadId: unknown }> = []
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'image')
          images.push({ src: node.attrs.src, uploadId: node.attrs.uploadId })
        return undefined
      })
      expect(images).toHaveLength(2)
      // The new upload landed on exactly one node; no node is stuck blank with a
      // leftover uploadId pointing at the wrong slot.
      expect(images.filter((i) => i.src === '/api/files/b')).toHaveLength(1)
      const stillPending = images.find((i) => i.src == null)!
      expect(stillPending.uploadId).not.toBeNull()

      // The first upload can still resolve into its own (untouched) slot.
      resolveFirst({ id: 'a', src: '/api/files/a' })
      await flushUploads()
      const srcs = new Set<unknown>()
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'image') srcs.add(node.attrs.src)
        return undefined
      })
      expect(srcs).toContain('/api/files/a')
      expect(srcs).toContain('/api/files/b')
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

// Позиция первой ноды данного типа (для ассертов каретки).
const findNodePos = (editor: Editor, name: string): { pos: number; size: number } | null => {
  let found: { pos: number; size: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === name) found = { pos, size: node.nodeSize }
    return undefined
  })
  return found
}

describe('caret placement after insertion', () => {
  const upload: UploadHandler = async () => ({ id: 'f', src: '/api/files/f' })

  it('places a text caret after the attachment when pasting mid-paragraph', () => {
    const editor = makeEditor()
    try {
      editor.commands.setContent('<p>hello world</p>')
      // Каретка в середине текста: "hello| world".
      editor.commands.setTextSelection(6)
      insertFileUploads(editor.view, upload, [new File(['x'], 'a.txt', { type: 'text/plain' })])

      const attachment = findNodePos(editor, 'fileAttachment')!
      const sel = editor.state.selection
      expect(sel).toBeInstanceOf(TextSelection)
      expect(sel.empty).toBe(true)
      // Каретка строго после ноды — набранный текст попадёт под файл, не над ним.
      expect(sel.from).toBeGreaterThanOrEqual(attachment.pos + attachment.size)
    } finally {
      editor.destroy()
    }
  })

  it('places a text caret after the image placeholder on paste', () => {
    const editor = makeEditor()
    try {
      editor.commands.setContent('<p>hello</p>')
      editor.commands.setTextSelection(6)
      insertImageUploads(editor.view, upload, [
        new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }),
      ])

      const image = findNodePos(editor, 'image')!
      const sel = editor.state.selection
      expect(sel).toBeInstanceOf(TextSelection)
      expect(sel.from).toBeGreaterThanOrEqual(image.pos + image.size)
    } finally {
      editor.destroy()
    }
  })

  it('creates a trailing paragraph for the caret when inserting at the very end', () => {
    const editor = makeEditor()
    try {
      editor.commands.setContent('<p>tail</p>')
      // Каретка в конец документа.
      editor.commands.setTextSelection(editor.state.doc.content.size)
      insertFileUploads(editor.view, upload, [new File(['x'], 'a.txt', { type: 'text/plain' })])

      const attachment = findNodePos(editor, 'fileAttachment')!
      const sel = editor.state.selection
      expect(sel).toBeInstanceOf(TextSelection)
      expect(sel.from).toBeGreaterThanOrEqual(attachment.pos + attachment.size)
      // Каретке есть где жить: после ноды существует текстовый блок.
      expect(sel.$from.parent.isTextblock).toBe(true)
    } finally {
      editor.destroy()
    }
  })

  it('inserts after a selected node instead of replacing it', async () => {
    const editor = makeEditor()
    try {
      insertFileUploads(editor.view, upload, [new File(['x'], 'first.txt', { type: 'text/plain' })])
      await flushUploads()
      const first = findNodePos(editor, 'fileAttachment')!
      // Выделяем существующую карточку как ноду (NodeSelection)…
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, first.pos)),
      )
      // …и вставляем ещё один файл: старая карточка должна уцелеть.
      insertFileUploads(editor.view, upload, [
        new File(['y'], 'second.txt', { type: 'text/plain' }),
      ])
      await flushUploads()

      const names: string[] = []
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'fileAttachment') names.push(String(node.attrs.name))
        return undefined
      })
      expect(names).toEqual(['first.txt', 'second.txt'])
      expect(editor.state.selection).toBeInstanceOf(TextSelection)
    } finally {
      editor.destroy()
    }
  })
})
