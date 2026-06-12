export type UploadKind = 'avatar' | 'attachment' | 'icon' | 'cover'

const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
// Page appearance kinds (Phase 9A): both are public-by-id (the avatar
// semantics) — small per-file caps bound abuse since they are quota-exempt.
const ICON_MAX_BYTES = 1 * 1024 * 1024
const COVER_MAX_BYTES = 10 * 1024 * 1024

const AVATAR_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const ATTACHMENT_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'application/zip',
])

const MAX_BYTES_BY_KIND: Record<UploadKind, number> = {
  avatar: AVATAR_MAX_BYTES,
  attachment: ATTACHMENT_MAX_BYTES,
  icon: ICON_MAX_BYTES,
  cover: COVER_MAX_BYTES,
}

// icon/cover are images only — same whitelist as avatars.
const MIME_BY_KIND: Record<UploadKind, Set<string>> = {
  avatar: AVATAR_MIME,
  attachment: ATTACHMENT_MIME,
  icon: AVATAR_MIME,
  cover: AVATAR_MIME,
}

export type ValidationError = { status: 400; message: string }

export const validateUpload = (
  kind: UploadKind,
  size: number,
  mimeType: string,
): ValidationError | null => {
  const maxBytes = MAX_BYTES_BY_KIND[kind]
  if (size === 0) return { status: 400, message: 'Empty file' }
  if (size > maxBytes) {
    return { status: 400, message: 'File too large' }
  }
  const allowed = MIME_BY_KIND[kind]
  if (!allowed.has(mimeType)) {
    return { status: 400, message: 'File type not allowed' }
  }
  return null
}

export const extractExt = (filename: string): string => {
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return ''
  return filename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16)
}

export const computeS3Key = (hash: string, ext: string): string => {
  const prefix = hash.slice(0, 2)
  return ext ? `${prefix}/${hash}.${ext}` : `${prefix}/${hash}`
}
