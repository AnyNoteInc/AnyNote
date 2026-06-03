import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import type { UploadHandler } from '../types'

// Intercept pasted images so they flow through the `image` node (ResizableImage):
// insert the empty placeholder immediately (same UX as /image), upload the blob,
// then swap in the uploaded src. Non-image pastes are left untouched so
// FileUpload and the default paste behavior still run.
//
// Robust positioning: a numeric offset can't re-find the placeholder — an insert
// shifts the node off the requested offset when it splits text, and several
// in-flight uploads would all match "the first empty image". So after building
// the insertion transaction we read back each placeholder's true position from
// the resulting doc, track them by a unique id, and remap every tracked position
// through later transactions. The async callback then resolves its placeholder
// by id, wherever it has drifted to.

type Pending = Map<string, number>

const imagePasteKey = new PluginKey<Pending>('imagePaste')

type PasteMeta = { adds?: { id: string; pos: number }[]; remove?: string }

let counter = 0
const nextId = () => `paste-${(counter += 1)}`

// Return `pos` only if an `image` node with no src still sits there (guards
// against the user having deleted the placeholder while the upload was in
// flight).
const placeholderAt = (view: EditorView, pos: number): number | null => {
  if (pos < 0 || pos > view.state.doc.content.size) return null
  const node = view.state.doc.nodeAt(pos)
  if (node && node.type.name === 'image' && node.attrs.src == null) return pos
  return null
}

export const buildImagePaste = (uploadHandler: UploadHandler) =>
  Extension.create({
    name: 'imagePaste',
    addProseMirrorPlugins() {
      return [
        new Plugin<Pending>({
          key: imagePasteKey,
          state: {
            init: () => new Map<string, number>(),
            apply(tr, value) {
              const meta = tr.getMeta(imagePasteKey) as PasteMeta | undefined
              // Remap every tracked position through this transaction's changes
              // so a pending placeholder keeps pointing at its image node even
              // as the document is edited above it.
              const next: Pending = new Map()
              for (const [id, pos] of value) next.set(id, tr.mapping.map(pos))
              if (meta?.adds) for (const a of meta.adds) next.set(a.id, a.pos)
              if (meta?.remove) next.delete(meta.remove)
              return next
            },
          },
          props: {
            handlePaste: (view, event) => {
              const files = Array.from(event.clipboardData?.files ?? [])
              const images = files.filter((file) => file.type.startsWith('image/'))
              if (images.length === 0) return false
              const imageType = view.state.schema.nodes.image
              if (!imageType) return false
              event.preventDefault()

              // Insert every placeholder in ONE transaction at successive
              // positions. Plain `insert` (vs replaceSelectionWith) keeps each
              // image distinct — replaceSelectionWith would dissolve an empty
              // paragraph and leave the cursor with nowhere to advance, so a
              // second pasted image would replace the first. Delete a non-empty
              // selection first so a paste over selected text behaves.
              const tr = view.state.tr
              const sel = view.state.selection
              if (!sel.empty) tr.delete(sel.from, sel.to)
              const insertBase = tr.mapping.map(sel.from)
              // ProseMirror nodes are immutable, so one frozen placeholder can be
              // reused for every insert in this transaction.
              const placeholder = imageType.create({ src: null })
              let at = insertBase
              for (let i = 0; i < images.length; i += 1) {
                tr.insert(at, placeholder)
                at += placeholder.nodeSize
              }

              // Read back each placeholder's true position from the built doc
              // (insert can shift the node off the requested offset), in document
              // order, then track them by id.
              const positions: number[] = []
              tr.doc.nodesBetween(
                Math.max(0, insertBase - 1),
                Math.min(tr.doc.content.size, at + 1),
                (node, pos) => {
                  if (node.type.name === 'image' && node.attrs.src == null) {
                    positions.push(pos)
                    return false
                  }
                  return undefined
                },
              )

              const adds: { id: string; pos: number }[] = []
              const queued: { id: string; file: File }[] = []
              images.forEach((file, i) => {
                const pos = positions[i]
                if (pos == null) return
                const id = nextId()
                adds.push({ id, pos })
                queued.push({ id, file })
              })
              tr.setMeta(imagePasteKey, { adds } as PasteMeta)
              view.dispatch(tr)

              for (const { id, file } of queued) {
                void uploadHandler({ blob: file, filename: file.name || 'pasted-image' })
                  .then((result) => {
                    const tracked = imagePasteKey.getState(view.state)?.get(id)
                    if (tracked == null) return
                    const target = placeholderAt(view, tracked)
                    if (target == null) {
                      view.dispatch(
                        view.state.tr.setMeta(imagePasteKey, { remove: id } as PasteMeta),
                      )
                      return
                    }
                    const next = view.state.tr.setNodeAttribute(target, 'src', result.src)
                    view.dispatch(next.setMeta(imagePasteKey, { remove: id } as PasteMeta))
                  })
                  .catch(() => {
                    const tracked = imagePasteKey.getState(view.state)?.get(id)
                    const next = view.state.tr.setMeta(imagePasteKey, { remove: id } as PasteMeta)
                    const target = tracked == null ? null : placeholderAt(view, tracked)
                    const node = target == null ? null : view.state.doc.nodeAt(target)
                    if (target != null && node) next.delete(target, target + node.nodeSize)
                    view.dispatch(next)
                  })
              }
              return true
            },
          },
        }),
      ]
    },
  })
