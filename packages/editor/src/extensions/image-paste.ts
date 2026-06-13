import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import type { UploadHandler } from '../types'

// Intercept pasted images so they flow through the `image` node (ResizableImage):
// insert an empty placeholder immediately (same UX as /image), upload the blob,
// then swap in the uploaded src. Non-image pastes are left untouched so
// FileUpload and the default paste behavior still run.
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

const imagePasteKey = new PluginKey('imagePaste')

let counter = 0
const nextId = () => `paste-${(counter += 1)}`

// Find the live position of the still-empty placeholder carrying this uploadId,
// wherever it has drifted to (or null if the user deleted it mid-upload).
const findPlaceholder = (view: EditorView, uploadId: string): number | null => {
  let found: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (found != null) return false
    if (node.type.name === 'image' && node.attrs.uploadId === uploadId) {
      found = pos
      return false
    }
    return undefined
  })
  return found
}

export const buildImagePaste = (uploadHandler: UploadHandler) =>
  Extension.create({
    name: 'imagePaste',
    // Outrank the default-priority FileUpload extension. Tiptap collects
    // ProseMirror plugins from `[...extensions].reverse()`, so at equal priority
    // FileUpload's `handlePaste` would run first and swallow pasted images into
    // its own `uploadImage` node. A higher priority sorts imagePaste ahead so it
    // claims image pastes (and declines everything else, leaving FileUpload to
    // handle non-image files).
    priority: 200,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: imagePasteKey,
          props: {
            handlePaste: (view, event) => {
              const files = Array.from(event.clipboardData?.files ?? [])
              const images = files.filter((file) => file.type.startsWith('image/'))
              if (images.length === 0) return false
              const imageType = view.state.schema.nodes.image
              if (!imageType) return false
              event.preventDefault()

              // Insert every placeholder in ONE transaction at successive
              // positions, each stamped with its own uploadId. Plain `insert`
              // (vs replaceSelectionWith) keeps each image distinct —
              // replaceSelectionWith would dissolve an empty paragraph and leave
              // the cursor with nowhere to advance, so a second pasted image
              // would replace the first. Delete a non-empty selection first so a
              // paste over selected text behaves.
              const tr = view.state.tr
              const sel = view.state.selection
              if (!sel.empty) tr.delete(sel.from, sel.to)
              const queued = images.map((file) => ({ id: nextId(), file }))

              // Insert one blank placeholder per image, then stamp uploadIds by
              // document order. We don't stamp during insertion because an inline
              // image atom can land in reverse order when several are inserted at
              // successive offsets; reading the built doc back in document order
              // and pairing it with paste order keeps the visual order stable.
              const insertBase = tr.mapping.map(sel.from)
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
              view.dispatch(tr)

              for (const { id, file } of queued) {
                void uploadHandler({ blob: file, filename: file.name || 'pasted-image' })
                  .then((result) => {
                    // The upload can resolve long after the editor unmounts —
                    // dispatching on a destroyed view throws. The findPlaceholder
                    // re-find no-ops if the node is gone, but the node may still
                    // exist in a destroyed view's last state, so guard the view too.
                    if (view.isDestroyed) return
                    const target = findPlaceholder(view, id)
                    if (target == null) return
                    // Clear the transient marker as we fill in the real src.
                    try {
                      view.dispatch(
                        view.state.tr
                          .setNodeAttribute(target, 'src', result.src)
                          .setNodeAttribute(target, 'uploadId', null),
                      )
                    } catch {
                      // View torn down between the guard and dispatch — ignore.
                    }
                  })
                  .catch(() => {
                    if (view.isDestroyed) return
                    const target = findPlaceholder(view, id)
                    if (target == null) return
                    const node = view.state.doc.nodeAt(target)
                    if (!node) return
                    try {
                      view.dispatch(view.state.tr.delete(target, target + node.nodeSize))
                    } catch {
                      // View torn down — nothing to clean up.
                    }
                  })
              }
              return true
            },
          },
        }),
      ]
    },
  })
