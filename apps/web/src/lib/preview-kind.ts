// Single source of truth for «что можно показать в просмотрщике файлов».
// Consumed by the file-preview UI (apps/web/src/components/page/file-preview/)
// and by the office-conversion route (/api/files/[id]/preview-pdf).
//
// Attachment MIME types are client-declared (file-validation.ts accepts any),
// so every family also has an extension fallback.

export type PreviewType = 'image' | 'svg' | 'pdf' | 'video' | 'audio' | 'text' | 'office'

/** Files above this are not fetched for the text preview — download prompt instead. */
export const TEXT_PREVIEW_MAX_BYTES = 1_048_576

const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'log'])

const OFFICE_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'text/rtf',
])
const OFFICE_EXT = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'rtf',
])

const normalizeExt = (ext: string | null): string => (ext ?? '').toLowerCase().replace(/^\./, '')

export function extFromFileName(name: string | null): string | null {
  const match = (name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] ?? null
}

export function resolvePreviewType(
  mimeType: string | null,
  ext: string | null,
): PreviewType | null {
  // Strip MIME parameters: 'text/plain; charset=utf-8' → 'text/plain'.
  const mime = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  const extension = normalizeExt(ext)
  // SVG first — it matches image/* but needs the blob-in-<img> path (XSS-safe).
  if (mime === 'image/svg+xml' || extension === 'svg') return 'svg'
  if (mime === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  // text/rtf is an OFFICE format (LibreOffice renders it), not a plain-text one.
  if (OFFICE_MIME.has(mime) || OFFICE_EXT.has(extension)) return 'office'
  if (TEXT_MIME.has(mime) || TEXT_EXT.has(extension)) return 'text'
  return null
}

/** '/api/files/<uuid>' → '<uuid>'; null для любых других URL (внешние ссылки). */
export function extractApiFileId(url: string): string | null {
  const match = url.match(
    /^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
  )
  return match?.[1] ?? null
}
