// Pure click-routing + payload builders for the file-preview feature (spec §2).
// No React, no Tiptap — unit-tested alone (the drawio-interaction.ts pattern).

import type { FilePreviewFilePayload } from '../types'
import type { FileAttachmentAttrs, MediaNodeAttrs } from './media-mime'

/** image-нода: read-only открывает просмотр одинарным кликом; в режиме
 *  редактирования одинарный клик оставлен выделению (ресайз/выравнивание),
 *  просмотр — по двойному клику (и по кнопке тулбара). */
export const shouldOpenImagePreview = (args: {
  isEditable: boolean
  isDoubleClick: boolean
}): boolean => !args.isEditable || args.isDoubleClick

export const imagePreviewPayload = (attrs: {
  src: string | null
  name: string | null
  size: number | null
  mimeType: string | null
}): FilePreviewFilePayload | null => {
  if (!attrs.src) return null
  return {
    kind: 'file',
    url: attrs.src,
    name: attrs.name,
    // Legacy images have no stamped mimeType — 'image/*' still routes to the
    // raster viewer in apps/web resolvePreviewType.
    mimeType: attrs.mimeType || 'image/*',
    size: attrs.size,
  }
}

export const attachmentPreviewPayload = (attrs: FileAttachmentAttrs): FilePreviewFilePayload => ({
  kind: 'file',
  url: attrs.url,
  name: attrs.name || null,
  mimeType: attrs.mimeType || null,
  size: attrs.size || null,
})

export const mediaPreviewPayload = (attrs: MediaNodeAttrs): FilePreviewFilePayload => ({
  kind: 'file',
  url: attrs.url,
  name: attrs.name || null,
  mimeType: attrs.mimeType || null,
  size: attrs.size || null,
})
