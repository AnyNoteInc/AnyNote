import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import { insertFileUploads, insertImageUploads } from './upload-insert'
import type { UploadHandler } from '../types'

// Intercept pasted images so they flow through the `image` node (ResizableImage):
// insert an empty placeholder immediately (same UX as /image), upload the blob,
// then swap in the uploaded src — see upload-insert.ts for the shared
// placeholder/uploadId machinery. Non-image pastes are left untouched so
// FileUpload and the default paste behavior still run.

const imagePasteKey = new PluginKey('imagePaste')

export const buildImagePaste = (uploadHandler: UploadHandler) =>
  Extension.create({
    name: 'imagePaste',
    // Outrank the default-priority FileUpload extension. Tiptap collects
    // ProseMirror plugins from `[...extensions].reverse()`, so at equal priority
    // FileUpload's `handlePaste` would run first and swallow pasted images into
    // its own node. A higher priority sorts imagePaste ahead so it claims image
    // pastes (and declines everything else, leaving FileUpload to handle
    // non-image files).
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
              if (!view.state.schema.nodes.image) return false
              event.preventDefault()
              insertImageUploads(view, uploadHandler, images)
              // Mixed clipboard (images + other files in one paste): claiming
              // the event here used to silently drop the non-image files —
              // route them through the fileAttachment pipeline too.
              const rest = files.filter((file) => !file.type.startsWith('image/'))
              if (rest.length > 0) insertFileUploads(view, uploadHandler, rest)
              return true
            },
          },
        }),
      ]
    },
  })
