// Pure helpers shared by the video/audio nodes, the file-upload routing, and the
// media slash popover. No React, no Tiptap node views — safe to unit-test alone.
//
// The validation source of truth lives in apps/web `file-validation.ts`
// (MEDIA_MIME, the 200MB cap, the magic-byte sniff). The editor is isolated from
// apps/web, so it carries its own `accept` string mirroring that MIME list — the
// server re-validates on upload, so this is only a file-picker hint.

/** The media MIME list (spec §2), mirrored for the file picker `accept` attr. */
export const MEDIA_MIME = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
] as const

/** `accept` attribute value for the media file picker. */
export const MEDIA_ACCEPT = 'video/*,audio/*'

/**
 * Which editor node a freshly uploaded blob should become. `image` keeps flowing
 * through the image-paste path; `video`/`audio` get their inline players; anything
 * else becomes a plain file attachment.
 */
export type MediaKind = 'image' | 'video' | 'audio' | 'file'

export const inferMediaKind = (mime: string): MediaKind => {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

// ── Convert swap (fileAttachment ↔ video/audio) ─────────────────────────────
// A pure node-type swap keeping url/name/size/mimeType. Used by the node-toolbar
// «Воспроизвести как видео» / «Показать как файл» actions.

export type FileAttachmentAttrs = {
  url: string
  name: string
  size: number
  mimeType: string
  ext: string
}

export type MediaNodeAttrs = {
  url: string
  name: string
  size: number
  mimeType: string
}

export type MediaNodeJSON = {
  type: 'video' | 'audio'
  attrs: MediaNodeAttrs
}

export type AttachmentNodeJSON = {
  type: 'fileAttachment'
  attrs: FileAttachmentAttrs
}

const extFromName = (name: string): string => {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m?.[1] ?? ''
}

/**
 * Swap a fileAttachment to the matching media node — `video` for a video/* mime,
 * `audio` for audio/*. Returns null when the mime can't be played inline (so the
 * caller hides the «Воспроизвести как видео» action).
 */
export const attachmentToMediaNode = (attrs: FileAttachmentAttrs): MediaNodeJSON | null => {
  const kind = inferMediaKind(attrs.mimeType)
  if (kind !== 'video' && kind !== 'audio') return null
  return {
    type: kind,
    attrs: {
      url: attrs.url,
      name: attrs.name,
      size: attrs.size,
      mimeType: attrs.mimeType,
    },
  }
}

/** Reverse: a media node back to a fileAttachment, re-deriving `ext` from the name. */
export const mediaToAttachmentNode = (attrs: MediaNodeAttrs): AttachmentNodeJSON => ({
  type: 'fileAttachment',
  attrs: {
    url: attrs.url,
    name: attrs.name,
    size: attrs.size,
    mimeType: attrs.mimeType,
    ext: extFromName(attrs.name),
  },
})

// ── Convert swap (image ↔ fileAttachment) ────────────────────────────────────
// The «вставка как файла или изображения» pair: a pasted image can be re-shown
// as a downloadable attachment, and an image/* attachment as an inline image.

export type ImageNodeMeta = {
  src: string | null
  name?: string | null
  size?: number | null
  mimeType?: string | null
}

export type ImageNodeJSON = {
  type: 'image'
  attrs: {
    src: string
    name: string | null
    size: number | null
    mimeType: string | null
  }
}

/**
 * Swap an image node to a fileAttachment («Сохранить как файл»). Metadata is
 * best-effort: images inserted before name/size/mimeType were stamped fall
 * back to a generic name (with the mime subtype as extension when known).
 * Null while the image has no uploaded src (placeholder) — the caller hides
 * the action.
 */
export const imageToAttachmentNode = (attrs: ImageNodeMeta): AttachmentNodeJSON | null => {
  if (!attrs.src) return null
  const mimeType = attrs.mimeType || 'image/unknown'
  const subtype = mimeType.split('/')[1] ?? ''
  const fallbackName =
    subtype !== 'unknown' && /^[a-z0-9]+$/.test(subtype) ? `изображение.${subtype}` : 'изображение'
  const name = attrs.name || fallbackName
  return {
    type: 'fileAttachment',
    attrs: {
      url: attrs.src,
      name,
      size: attrs.size ?? 0,
      mimeType,
      ext: extFromName(name),
    },
  }
}

/**
 * Reverse: an image/* fileAttachment back to an inline image («Показать как
 * изображение»). Null for non-image attachments — the caller hides the action.
 */
export const attachmentToImageNode = (attrs: FileAttachmentAttrs): ImageNodeJSON | null => {
  if (inferMediaKind(attrs.mimeType) !== 'image') return null
  return {
    type: 'image',
    attrs: {
      src: attrs.url,
      name: attrs.name || null,
      size: attrs.size || null,
      mimeType: attrs.mimeType || null,
    },
  }
}
