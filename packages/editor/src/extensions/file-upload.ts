import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { inferMediaKind } from './media-mime'
import type { UploadHandler } from '../types'

// Handle non-image file paste/drop. Images are claimed by the higher-priority
// `imagePaste` plugin (→ `image` node); everything else lands here and routes by
// MIME: video/* → `video` node, audio/* → `audio` node, else → `fileAttachment`.
//
// All three nodes get an empty placeholder inserted up front at the paste/drop
// position, stamped with a transient `uploadId` attr, then re-found and filled
// once the async upload resolves — a content-addressed lookup immune to Yjs
// position remapping (the image-paste precedent). On upload failure the
// placeholder is removed.

const fileUploadKey = new PluginKey('fileUpload')

let counter = 0
const nextId = () => `upload-${(counter += 1)}`

type TargetNode = 'video' | 'audio' | 'fileAttachment'

const getExtension = (name: string): string => {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m?.[1] ?? ''
}

const targetFor = (mime: string): TargetNode => {
  const k = inferMediaKind(mime)
  if (k === 'video' || k === 'audio') return k
  return 'fileAttachment'
}

// Find the live position of the placeholder carrying this uploadId.
const findPlaceholder = (
  view: EditorView,
  nodeName: TargetNode,
  uploadId: string,
): number | null => {
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found != null) return false
    if (node.type.name === nodeName && node.attrs.uploadId === uploadId) {
      found = pos
      return false
    }
    return undefined
  })
  return found
}

const handleFiles = (view: EditorView, uploadHandler: UploadHandler, files: File[]): boolean => {
  const nonImages = files.filter((f) => !f.type.startsWith('image/'))
  if (nonImages.length === 0) return false

  const schema = view.state.schema
  const jobs = nonImages
    .map((file) => ({ node: targetFor(file.type), id: nextId(), file }))
    .filter((job) => schema.nodes[job.node])
  if (jobs.length === 0) return false

  // Insert one empty placeholder per file at successive positions, each stamped
  // with its own uploadId.
  const tr = view.state.tr
  const sel = view.state.selection
  if (!sel.empty) tr.delete(sel.from, sel.to)
  let at = tr.mapping.map(sel.from)
  for (const job of jobs) {
    const placeholder = schema.nodes[job.node]!.create({
      url: '',
      name: job.file.name,
      uploadId: job.id,
    })
    tr.insert(at, placeholder)
    at += placeholder.nodeSize
  }
  view.dispatch(tr)

  for (const job of jobs) {
    void uploadHandler({ blob: job.file, filename: job.file.name })
      .then((result) => {
        const target = findPlaceholder(view, job.node, job.id)
        if (target == null) return
        let next = view.state.tr
          .setNodeAttribute(target, 'url', result.src)
          .setNodeAttribute(target, 'name', job.file.name)
          .setNodeAttribute(target, 'size', job.file.size)
          .setNodeAttribute(target, 'mimeType', job.file.type || 'application/octet-stream')
          .setNodeAttribute(target, 'uploadId', null)
        if (job.node === 'fileAttachment') {
          next = next.setNodeAttribute(target, 'ext', getExtension(job.file.name))
        }
        view.dispatch(next)
      })
      .catch(() => {
        const target = findPlaceholder(view, job.node, job.id)
        if (target == null) return
        const node = view.state.doc.nodeAt(target)
        if (node) view.dispatch(view.state.tr.delete(target, target + node.nodeSize))
      })
  }
  return true
}

export const buildFileUpload = (uploadHandler: UploadHandler) =>
  Extension.create({
    name: 'fileUpload',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: fileUploadKey,
          props: {
            handlePaste: (view, event) => {
              const files = Array.from(event.clipboardData?.files ?? [])
              if (files.length === 0) return false
              const handled = handleFiles(view, uploadHandler, files)
              if (handled) event.preventDefault()
              return handled
            },
            handleDrop: (view, event) => {
              const dt = (event as DragEvent).dataTransfer
              if (!dt?.types.includes('Files')) return false
              const files = Array.from(dt.files ?? [])
              if (files.length === 0) return false
              const handled = handleFiles(view, uploadHandler, files)
              if (handled) event.preventDefault()
              return handled
            },
          },
        }),
      ]
    },
  })
