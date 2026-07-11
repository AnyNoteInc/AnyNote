export type UploadKind = 'avatar' | 'attachment' | 'icon' | 'cover' | 'media'

const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
// Page appearance kinds (Phase 9A): both are public-by-id (the avatar
// semantics) — small per-file caps bound abuse since they are quota-exempt.
const ICON_MAX_BYTES = 1 * 1024 * 1024
const COVER_MAX_BYTES = 10 * 1024 * 1024
// Media kind (Phase 9B): video/audio inline players. Quota-counted like
// attachments and served auth-gated (NOT public). 200MB cap.
//
// INFRA NOTE: this 200MB is a per-app LOGICAL limit enforced in `validateUpload`.
// For an upload of this size to actually reach the route, the surrounding infra
// must allow it: the reverse proxy (Traefik) must not cap the request body below
// 200MB (Traefik v3 does not buffer/limit bodies by default, but if a `buffering`
// middleware with `maxRequestBodyBytes` is ever added, it must be ≥ this cap —
// see deploy/traefik/dynamic/middlewares.yml), and the Node process must have
// enough heap, since the route buffers the whole file via `file.arrayBuffer()`
// before hashing/storing. Operators raising/lowering this cap must keep the proxy
// limit and Node heap in step.
const MEDIA_MAX_BYTES = 200 * 1024 * 1024

const AVATAR_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

// The media whitelist (spec §2): video/* + audio/* containers we can sniff.
const MEDIA_MIME = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
])

const MAX_BYTES_BY_KIND: Record<UploadKind, number> = {
  avatar: AVATAR_MAX_BYTES,
  attachment: ATTACHMENT_MAX_BYTES,
  icon: ICON_MAX_BYTES,
  cover: COVER_MAX_BYTES,
  media: MEDIA_MAX_BYTES,
}

// icon/cover are images only — same whitelist as avatars. `attachment` has NO
// MIME whitelist (null): chat/page attachments accept любой файл — they are
// auth-gated, quota-counted, and served with a download-only disposition for
// anything that isn't inline-safe (see /api/files/[id]).
const MIME_BY_KIND: Record<UploadKind, Set<string> | null> = {
  avatar: AVATAR_MIME,
  attachment: null,
  icon: AVATAR_MIME,
  cover: AVATAR_MIME,
  media: MEDIA_MIME,
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
  if (allowed && !allowed.has(mimeType)) {
    return { status: 400, message: 'File type not allowed' }
  }
  return null
}

// ── Inline-safe serving whitelist ────────────────────────────────────────────
// Attachments accept ANY declared MIME, and /api/files/[id] serves bytes back
// on the app origin. Active content rendered inline there (text/html, SVG,
// XML) would be same-origin stored XSS, so only types a browser can't script
// may keep `Content-Disposition: inline`; everything else is forced to
// download. The declared MIME is client-controlled — treat unknown as unsafe.
const INLINE_SAFE_EXACT = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
])

export const isInlineSafeMime = (mimeType: string): boolean => {
  if (mimeType === 'image/svg+xml') return false
  if (mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
    return true
  }
  return INLINE_SAFE_EXACT.has(mimeType)
}

// ── Magic-byte sniffing for the image whitelist ──────────────────────────────
// The multipart contentType is client-controlled; public kinds (avatar/icon/
// cover) are served back by unguessable id to *anyone*, so the bytes must
// actually be one of the whitelisted image formats. SVG is deliberately absent
// from AVATAR_MIME, so no XML sniffing is needed — 4 fixed prefixes suffice.

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0): boolean =>
  bytes.length >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b)

/** The detected image MIME for the 4 whitelisted formats, or null when unknown. */
export const sniffImageMime = (bytes: Uint8Array): string | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  // RIFF????WEBP — bytes 4..7 are the chunk size.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  return null
}

// ── Magic-byte sniffing for the media whitelist (Phase 9B) ───────────────────
// The declared MIME is client-controlled; media is served auth-gated and embedded
// in `<video>`/`<audio>`, so the bytes must actually be a media container. We can
// only sniff the *container*, not the codec, so the route validates the declared
// MIME's *family* (video/* vs audio/*) against the sniffed family. Several
// containers (mp4/ogg/webm) legitimately carry both video and audio — those are
// treated as family-agnostic so e.g. `audio/ogg` and `video/ogg` both pass.

export type MediaFamily = 'video' | 'audio'

const ascii4 = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0))

/**
 * Major brand at offset 8 of an `ftyp` box, lowercased and trimmed of the
 * 4-char box's trailing padding (e.g. `"M4A "` → `"m4a"`), or null when absent.
 */
const ftypBrand = (bytes: Uint8Array): string | null => {
  if (!startsWith(bytes, ascii4('ftyp'), 4)) return null
  if (bytes.length < 12) return null
  return String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!).toLowerCase().trim()
}

// mp4-family brands that denote audio-only files (m4a/m4b). Everything else
// (isom, mp41/42, qt, avc1, …) is treated as video.
const AUDIO_FTYP_BRANDS = new Set(['m4a', 'm4b'])

/**
 * The media family of the bytes from its container signature, or null when the
 * bytes are not a recognised media container.
 *
 * Family-agnostic containers (ogg, webm/mkv) report 'video' as their nominal
 * family; the route's {@link mediaMimeMatchesSniff} accepts either declared
 * family for them. mp4 reports audio vs video by its `ftyp` major brand.
 */
export const sniffMediaMime = (bytes: Uint8Array): MediaFamily | null => {
  // WAV: RIFF????WAVE (RIFF????WEBP is an image, handled above)
  if (startsWith(bytes, ascii4('RIFF')) && startsWith(bytes, ascii4('WAVE'), 8)) return 'audio'
  // MP3: an ID3v2 tag, or a raw MPEG frame-sync (FF Fx, layer III: FB/F3/F2).
  if (startsWith(bytes, ascii4('ID3'))) return 'audio'
  if (
    startsWith(bytes, [0xff, 0xfb]) ||
    startsWith(bytes, [0xff, 0xf3]) ||
    startsWith(bytes, [0xff, 0xf2])
  )
    return 'audio'
  // mp4/mov/m4a: an `ftyp` box at offset 4; the major brand picks the family.
  const brand = ftypBrand(bytes)
  if (brand !== null) return AUDIO_FTYP_BRANDS.has(brand) ? 'audio' : 'video'
  // webm/mkv: the EBML header magic.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video'
  // Ogg container (carries Theora/Vorbis/Opus — video or audio).
  if (startsWith(bytes, ascii4('OggS'))) return 'video'
  return null
}

/** True when bytes start with a container that legitimately carries either family. */
const isFamilyAgnosticContainer = (bytes: Uint8Array): boolean =>
  startsWith(bytes, ascii4('OggS')) || startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])

/**
 * Whether the client-declared media MIME is consistent with the sniffed bytes.
 * The declared family (video/* vs audio/*) must match the sniffed family, except
 * for family-agnostic containers (ogg/webm) which satisfy either. Non-media bytes
 * (sniff null) never match.
 */
export const mediaMimeMatchesSniff = (declaredMime: string, bytes: Uint8Array): boolean => {
  const sniffed = sniffMediaMime(bytes)
  if (sniffed === null) return false
  const declaredFamily: MediaFamily | null = declaredMime.startsWith('video/')
    ? 'video'
    : declaredMime.startsWith('audio/')
      ? 'audio'
      : null
  if (declaredFamily === null) return false
  if (isFamilyAgnosticContainer(bytes)) return true
  return declaredFamily === sniffed
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
