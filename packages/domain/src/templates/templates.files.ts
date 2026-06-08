const FILE_URL_RE = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/**
 * Walk a ProseMirror/Tiptap JSON doc and collect the File ids referenced by
 * image `src` and file-attachment `url` attributes (`/api/files/{uuid}`).
 * Used to mark a published GLOBAL template's files public.
 */
export function extractFileIdsFromContent(content: unknown): string[] {
  const ids = new Set<string>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { attrs?: Record<string, unknown>; content?: unknown[] }
    if (n.attrs) {
      for (const key of ['src', 'url'] as const) {
        const v = n.attrs[key]
        if (typeof v === 'string') {
          const m = FILE_URL_RE.exec(v)
          if (m?.[1]) ids.add(m[1].toLowerCase())
        }
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(visit)
  }
  visit(content)
  return [...ids]
}
