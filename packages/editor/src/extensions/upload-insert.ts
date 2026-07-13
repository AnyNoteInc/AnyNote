import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { inferMediaKind } from './media-mime'
import type { UploadHandler } from '../types'

// Shared placeholder-first upload insertion, used by BOTH clipboard plugins
// (image-paste.ts claims image/*, file-upload.ts routes everything else) and
// by the drop path. One home keeps the two plugins cycle-free while they mix
// pipelines (an image drop lands here from file-upload; a mixed paste routes
// its non-image files here from image-paste).
//
// Why a node-attribute marker (`uploadId`) instead of a tracked numeric offset:
// the placeholder must be re-found after an async upload, but a numeric position
// cannot survive the document edits that happen meanwhile. Under Yjs collab the
// remote sync dispatches large structural transactions, and remapping a stored
// offset through them drifts it to a bogus position (observed: a node truly at
// pos 4 remapped to 204), so the callback can't find its placeholder and the
// src is never written. Instead we stamp each placeholder with a unique
// `uploadId` attribute and locate it by scanning the live doc for that id — a
// content-addressed lookup that is immune to any position remapping.

let counter = 0
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`

type FileTargetNode = 'video' | 'audio' | 'fileAttachment'

const getExtension = (name: string): string => {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m?.[1] ?? ''
}

const targetFor = (mime: string): FileTargetNode => {
  const k = inferMediaKind(mime)
  if (k === 'video' || k === 'audio') return k
  return 'fileAttachment'
}

// Где вставлять: при выделенной ноде (NodeSelection) — сразу после неё, не
// уничтожая её (раньше вставка поверх выделенной карточки молча удаляла её);
// текстовое выделение заменяется, как при обычной вставке.
const insertPosFor = (tr: Transaction, sel: Selection): number => {
  if (sel instanceof NodeSelection) return sel.to
  if (!sel.empty) tr.delete(sel.from, sel.to)
  return tr.mapping.map(sel.from)
}

// Фактический конец последнего вставленного плейсхолдера. Ручной счётчик
// `at` (insertBase + nodeSize) «сырая» позиция: фиттер при сплите параграфа
// добавляет закрывающие/открывающие токены и сдвигает ноду — поэтому конец
// ищем по живому документу транзакции.
const lastPlaceholderEnd = (
  tr: Transaction,
  isOurs: (node: { type: { name: string }; attrs: Record<string, unknown> }) => boolean,
): number | null => {
  let end: number | null = null
  tr.doc.descendants((node, pos) => {
    if (isOurs(node)) end = Math.max(end ?? 0, pos + node.nodeSize)
    return undefined
  })
  return end
}

// Ставим каретку ПОСЛЕ вставленных нод (text-only, чтобы никогда не получить
// NodeSelection на свежей карточке): обычно это параграф, который отщепил
// фиттер; в конце документа/контейнера — создаём пустой параграф.
const caretAfterInserted = (tr: Transaction, end: number): void => {
  const max = tr.doc.content.size
  const $end = tr.doc.resolve(Math.min(end, max))
  const after = Selection.findFrom($end, 1, true)
  if (after) {
    tr.setSelection(after)
    return
  }
  const paragraph = tr.doc.type.schema.nodes.paragraph?.createAndFill()
  if (paragraph) {
    const at = Math.min(end, max)
    tr.insert(at, paragraph)
    tr.setSelection(TextSelection.create(tr.doc, at + 1))
  }
}

// Find the live position of the still-pending placeholder carrying this
// uploadId, wherever it has drifted to (or null if the user deleted it
// mid-upload).
const findPlaceholder = (view: EditorView, nodeName: string, uploadId: string): number | null => {
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

const removePlaceholder = (view: EditorView, nodeName: string, uploadId: string): void => {
  if (view.isDestroyed) return
  const target = findPlaceholder(view, nodeName, uploadId)
  if (target == null) return
  const node = view.state.doc.nodeAt(target)
  if (!node) return
  try {
    view.dispatch(view.state.tr.delete(target, target + node.nodeSize))
  } catch {
    // View torn down between the guard and dispatch — nothing to clean up.
  }
}

/**
 * Insert an empty `image` placeholder per file at the selection, upload each
 * blob, then fill `src` (+ the name/size/mimeType metadata that the
 * «Сохранить как файл» swap needs) on the re-found placeholder. Returns false
 * when the schema has no image node.
 */
export const insertImageUploads = (
  view: EditorView,
  uploadHandler: UploadHandler,
  images: File[],
): boolean => {
  const imageType = view.state.schema.nodes.image
  if (!imageType || images.length === 0) return false

  // Insert every placeholder in ONE transaction at successive positions, each
  // stamped with its own uploadId. Plain `insert` (vs replaceSelectionWith)
  // keeps each image distinct — replaceSelectionWith would dissolve an empty
  // paragraph and leave the cursor with nowhere to advance, so a second pasted
  // image would replace the first. Delete a non-empty selection first so a
  // paste over selected text behaves.
  const tr = view.state.tr
  const sel = view.state.selection
  const queued = images.map((file) => ({ id: nextId('paste'), file }))

  // Insert one blank placeholder per image, then stamp uploadIds by document
  // order. We don't stamp during insertion because an inline image atom can
  // land in reverse order when several are inserted at successive offsets;
  // reading the built doc back in document order and pairing it with paste
  // order keeps the visual order stable.
  const insertBase = insertPosFor(tr, sel)
  let at = insertBase
  queued.forEach(() => {
    const placeholder = imageType.create({ src: null })
    tr.insert(at, placeholder)
    at += placeholder.nodeSize
  })
  const placeholderPositions: number[] = []
  tr.doc.nodesBetween(
    Math.max(0, insertBase - 1),
    Math.min(tr.doc.content.size, at + 1),
    (node, pos) => {
      if (node.type.name === 'image' && node.attrs.src == null) {
        placeholderPositions.push(pos)
        return false
      }
      return undefined
    },
  )
  queued.forEach(({ id }, i) => {
    const pos = placeholderPositions[i]
    if (pos != null) tr.setNodeAttribute(pos, 'uploadId', id)
  })
  const ids = new Set(queued.map(({ id }) => id))
  caretAfterInserted(
    tr,
    lastPlaceholderEnd(tr, (n) => n.type.name === 'image' && ids.has(String(n.attrs.uploadId))) ??
      at,
  )
  view.dispatch(tr)

  for (const { id, file } of queued) {
    void uploadHandler({ blob: file, filename: file.name || 'pasted-image' })
      .then((result) => {
        // The upload can resolve long after the editor unmounts — dispatching
        // on a destroyed view throws. The findPlaceholder re-find no-ops if the
        // node is gone, but the node may still exist in a destroyed view's last
        // state, so guard the view too.
        if (view.isDestroyed) return
        const target = findPlaceholder(view, 'image', id)
        if (target == null) return
        // Clear the transient marker as we fill in the real src + metadata.
        try {
          view.dispatch(
            view.state.tr
              .setNodeAttribute(target, 'src', result.src)
              .setNodeAttribute(target, 'name', file.name || null)
              .setNodeAttribute(target, 'size', file.size || null)
              .setNodeAttribute(target, 'mimeType', file.type || null)
              .setNodeAttribute(target, 'uploadId', null),
          )
        } catch {
          // View torn down between the guard and dispatch — ignore.
        }
      })
      .catch(() => removePlaceholder(view, 'image', id))
  }
  return true
}

/**
 * Insert a `video`/`audio`/`fileAttachment` placeholder per file (routed by
 * MIME) at the selection, upload each blob, then fill url/name/size/mimeType
 * on the re-found placeholder. Callers decide what to do with image/* files —
 * this routine routes them to `fileAttachment` like any other blob.
 */
export const insertFileUploads = (
  view: EditorView,
  uploadHandler: UploadHandler,
  files: File[],
): boolean => {
  if (files.length === 0) return false
  const schema = view.state.schema
  const jobs = files
    .map((file) => ({ node: targetFor(file.type), id: nextId('upload'), file }))
    .filter((job) => schema.nodes[job.node])
  if (jobs.length === 0) return false

  // Insert one empty placeholder per file at successive positions, each stamped
  // with its own uploadId.
  const tr = view.state.tr
  const sel = view.state.selection
  let at = insertPosFor(tr, sel)
  for (const job of jobs) {
    const placeholder = schema.nodes[job.node]!.create({
      url: '',
      name: job.file.name,
      uploadId: job.id,
    })
    tr.insert(at, placeholder)
    at += placeholder.nodeSize
  }
  const jobIds = new Set(jobs.map((job) => job.id))
  caretAfterInserted(tr, lastPlaceholderEnd(tr, (n) => jobIds.has(String(n.attrs.uploadId))) ?? at)
  view.dispatch(tr)

  for (const job of jobs) {
    void uploadHandler({ blob: job.file, filename: job.file.name })
      .then((result) => {
        if (view.isDestroyed) return
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
        try {
          view.dispatch(next)
        } catch {
          // View torn down between the guard and dispatch — ignore.
        }
      })
      .catch(() => removePlaceholder(view, job.node, job.id))
  }
  return true
}
