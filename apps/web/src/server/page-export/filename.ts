const FORMAT_EXT = { pdf: 'pdf', html: 'html', md: 'md' } as const

// Filesystem-unsafe characters plus ASCII control range; built via String.fromCharCode
// so the source file stays free of literal control characters.
const UNSAFE = new RegExp(
  `[/\\\\:*?"<>|${String.fromCharCode(0)}-${String.fromCharCode(31)}]+`,
  'g',
)

export type ExportFormat = keyof typeof FORMAT_EXT

export function buildFilename(rawTitle: string | null, format: ExportFormat): string {
  const trimmed = (rawTitle ?? '').trim() || 'Без названия'
  const safe = trimmed
    .replaceAll(UNSAFE, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
  return `${safe || 'page'}.${FORMAT_EXT[format]}`
}

export function contentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
}
