const FORMAT_EXT = { pdf: 'pdf', html: 'html', md: 'md' } as const
const UNSAFE = /[/\\:*?"<>|\x00-\x1f]+/g

export type ExportFormat = keyof typeof FORMAT_EXT

export function buildFilename(rawTitle: string | null, format: ExportFormat): string {
  const trimmed = (rawTitle ?? '').trim() || 'Без названия'
  const safe = trimmed
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
  return `${safe || 'page'}.${FORMAT_EXT[format]}`
}

export function contentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
}
