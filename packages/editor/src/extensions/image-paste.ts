import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import type { UploadHandler } from '../types'

// Intercept pasted images so they flow through the `image` node (ResizableImage):
// insert the empty placeholder immediately (same UX as /image), upload the blob,
// then set `src` by position. Non-image pastes are left untouched so FileUpload
// and the default paste behavior still run.
export const buildImagePaste = (uploadHandler: UploadHandler) =>
  Extension.create({
    name: 'imagePaste',
    addProseMirrorPlugins() {
      const editor = this.editor
      return [
        new Plugin({
          key: new PluginKey('imagePaste'),
          props: {
            handlePaste: (view, event) => {
              const files = Array.from(event.clipboardData?.files ?? [])
              const images = files.filter((f) => f.type.startsWith('image/'))
              if (images.length === 0) return false
              event.preventDefault()

              for (const file of images) {
                // Insert an empty image node at the current selection and capture
                // its position from the resulting doc.
                const insertPos = view.state.selection.from
                editor
                  .chain()
                  .insertContentAt(insertPos, { type: 'image', attrs: { src: null } })
                  .run()

                void uploadHandler({ blob: file, filename: file.name || 'pasted-image' })
                  .then((result) => {
                    // Find the placeholder image node at/after insertPos and set src.
                    const { doc } = editor.state
                    let target: number | null = null
                    doc.nodesBetween(
                      insertPos,
                      Math.min(insertPos + 2, doc.content.size),
                      (node, pos) => {
                        if (
                          target === null &&
                          node.type.name === 'image' &&
                          node.attrs.src === null
                        ) {
                          target = pos
                          return false
                        }
                        return undefined
                      },
                    )
                    if (target !== null) {
                      editor
                        .chain()
                        .command(({ tr }) => {
                          tr.setNodeAttribute(target as number, 'src', result.src)
                          return true
                        })
                        .run()
                    }
                  })
                  .catch(() => {
                    // On failure, remove the placeholder we inserted.
                    const { doc } = editor.state
                    let target: number | null = null
                    let size = 0
                    doc.nodesBetween(
                      insertPos,
                      Math.min(insertPos + 2, doc.content.size),
                      (node, pos) => {
                        if (
                          target === null &&
                          node.type.name === 'image' &&
                          node.attrs.src === null
                        ) {
                          target = pos
                          size = node.nodeSize
                          return false
                        }
                        return undefined
                      },
                    )
                    if (target !== null) {
                      editor
                        .chain()
                        .command(({ tr }) => {
                          tr.delete(target as number, (target as number) + size)
                          return true
                        })
                        .run()
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
