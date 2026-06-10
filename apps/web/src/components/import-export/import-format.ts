export type ImportFormat = 'MARKDOWN' | 'HTML' | 'ZIP'

export function detectImportFormat(fileName: string): ImportFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'zip') return 'ZIP'
  if (ext === 'md' || ext === 'markdown') return 'MARKDOWN'
  if (ext === 'html' || ext === 'htm') return 'HTML'
  return null
}

// Browsers often report '' for .md and platform-specific types for .zip
// (e.g. application/x-zip-compressed), and text/html is deliberately NOT in the
// upload allowlist (stored HTML served inline = XSS). Force safe MIME values.
export function uploadMimeFor(format: ImportFormat): string {
  return format === 'ZIP' ? 'application/zip' : 'text/plain'
}
