// @vitest-environment happy-dom
// Regression for the wave-4 review finding: DropPlacement's handleDrop runs
// BEFORE fileUpload's in the assembled editor (default-priority extensions are
// collected reversed), and used to claim external OS file drops — the empty
// slice no-op-inserted, preventDefault'ed, and the dropped file was silently
// swallowed. applyPlacementDrop must now DECLINE file drops (empty slice +
// dataTransfer.files) so fileUpload can insert the image/file placeholder.
//
// The drop is dispatched through view.someProp('handleDrop', …) — the exact
// prop-walk prosemirror-view uses — because happy-dom can't service
// posAtCoords for a real DOM drop event.

import { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { Slice } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DropPlacement, dropPlacementKey } from './drop-placement'
import { buildFileUpload } from './file-upload'
import { FileAttachmentSchema } from './file-attachment.schema'
import type { UploadHandler } from '../types'

const noopUpload: UploadHandler = vi.fn(async () => ({ id: 'x', src: '/api/files/x' }))

const makeEditor = () => {
  const element = document.createElement('div')
  return new Editor({
    element,
    content: '<p>первый</p><p>второй</p>',
    // Mirror the REAL buildExtensions order (fileUpload declared before
    // DropPlacement): Tiptap collects plugins from [...extensions].reverse(),
    // so DropPlacement's handleDrop runs FIRST — the shadowing under test.
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Image,
      FileAttachmentSchema,
      buildFileUpload(noopUpload),
      DropPlacement,
    ],
  })
}

const makeFileDropEvent = (files: File[]): DragEvent => {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: ['Files'], getData: () => '' },
  })
  Object.defineProperty(event, 'clientX', { value: 10 })
  Object.defineProperty(event, 'clientY', { value: 10 })
  return event
}

const nodeNames = (editor: Editor): string[] => {
  const names: string[] = []
  editor.state.doc.descendants((node) => {
    names.push(node.type.name)
    return undefined
  })
  return names
}

afterEach(async () => {
  // Drain Tiptap's queued mount() focus macrotask before happy-dom teardown.
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('external file drop vs DropPlacement', () => {
  it('fileUpload claims an image drop even when a placement zone is active', () => {
    const editor = makeEditor()
    try {
      // Arm a placement exactly as a dragover would (TOP of the first block).
      editor.view.dispatch(
        editor.state.tr.setMeta(dropPlacementKey, {
          zone: 'TOP',
          target: { kind: 'block', pos: 0, node: editor.state.doc.child(0) },
        }),
      )
      const event = makeFileDropEvent([
        new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }),
      ])
      const claimed = editor.view.someProp('handleDrop', (f) =>
        f(editor.view, event, Slice.empty, false),
      )
      expect(claimed).toBe(true)
      expect(nodeNames(editor)).toContain('image')
      // The placement must be released, not left painting a stale indicator.
      expect(dropPlacementKey.getState(editor.state)?.zone ?? null).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it('fileUpload claims a non-image drop the same way (fileAttachment placeholder)', () => {
    const editor = makeEditor()
    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(dropPlacementKey, {
          zone: 'BOTTOM',
          target: { kind: 'block', pos: 0, node: editor.state.doc.child(0) },
        }),
      )
      const event = makeFileDropEvent([new File(['hi'], 'note.txt', { type: 'text/plain' })])
      const claimed = editor.view.someProp('handleDrop', (f) =>
        f(editor.view, event, Slice.empty, false),
      )
      expect(claimed).toBe(true)
      expect(nodeNames(editor)).toContain('fileAttachment')
    } finally {
      editor.destroy()
    }
  })

  it('in-editor block drags (non-empty slice) still go through DropPlacement', () => {
    const editor = makeEditor()
    try {
      editor.view.dispatch(
        editor.state.tr.setMeta(dropPlacementKey, {
          zone: 'TOP',
          target: { kind: 'block', pos: 0, node: editor.state.doc.child(0) },
        }),
      )
      // A block drag carries the dragged content; no OS files on the transfer.
      const slice = editor.state.doc.slice(
        editor.state.doc.child(0).nodeSize,
        editor.state.doc.content.size,
      )
      const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [], types: [], getData: () => '' },
      })
      editor.view.someProp('handleDrop', (f) => f(editor.view, event, slice, true))
      // The file-drop decline guard must NOT fire for in-editor drags: no
      // upload placeholders appear and the armed placement survives untouched
      // for DropPlacement's own logic.
      expect(nodeNames(editor)).not.toContain('image')
      expect(nodeNames(editor)).not.toContain('fileAttachment')
    } finally {
      editor.destroy()
    }
  })
})
