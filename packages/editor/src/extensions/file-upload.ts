import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

import { insertFileUploads, insertImageUploads } from './upload-insert'
import type { UploadHandler } from '../types'

// Handle file paste/drop. For PASTE, images are claimed by the higher-priority
// `imagePaste` plugin (→ `image` node); everything else lands here and routes by
// MIME: video/* → `video` node, audio/* → `audio` node, else → `fileAttachment`
// (see upload-insert.ts for the shared placeholder/uploadId machinery). For
// DROP this plugin owns images too — imagePaste registers no handleDrop, so an
// OS drop of an image file used to be claimed by nobody and did nothing.

export const fileUploadKey = new PluginKey('fileUpload')

const isImage = (file: File): boolean => file.type.startsWith('image/')

/** Move the selection to the drop point so the placeholders land where the
 *  file was dropped, not at the (possibly off-screen) caret. */
const moveSelectionToDrop = (view: EditorView, event: DragEvent): void => {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!coords) return
  try {
    view.dispatch(
      view.state.tr.setSelection(Selection.near(view.state.doc.resolve(coords.pos))),
    )
  } catch {
    // Unresolvable position — fall back to the current selection.
  }
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
              const handled = insertFileUploads(
                view,
                uploadHandler,
                files.filter((file) => !isImage(file)),
              )
              if (handled) event.preventDefault()
              return handled
            },
            handleDrop: (view, event) => {
              const dt = (event as DragEvent).dataTransfer
              if (!dt?.types.includes('Files')) return false
              const files = Array.from(dt.files ?? [])
              if (files.length === 0) return false
              moveSelectionToDrop(view, event as DragEvent)
              let handled = insertImageUploads(view, uploadHandler, files.filter(isImage))
              handled =
                insertFileUploads(
                  view,
                  uploadHandler,
                  files.filter((file) => !isImage(file)),
                ) || handled
              if (handled) event.preventDefault()
              return handled
            },
          },
        }),
      ]
    },
  })
