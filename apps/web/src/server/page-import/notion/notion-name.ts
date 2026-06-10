const TRAILING_ID_RE = /\s([0-9a-f]{32})$/i
const ONLY_ID_RE = /^([0-9a-f]{32})$/i
const HREF_ID_RE = /(?:^|[\s/_-])([0-9a-f]{32})(?:\.(?:md|html|csv))?(?:[?#]|$)/i

export function splitNotionName(name: string): { title: string; notionId: string | null } {
  const only = ONLY_ID_RE.exec(name.trim())
  if (only) return { title: 'Без названия', notionId: only[1]!.toLowerCase() }
  const m = TRAILING_ID_RE.exec(name)
  if (!m) return { title: name, notionId: null }
  const title = name.slice(0, m.index).trim() || 'Без названия'
  return { title, notionId: m[1]!.toLowerCase() }
}

/** Clean every path segment of its Notion id suffix; the extension survives. */
export function cleanNotionPath(path: string): { cleaned: string; ids: string[] } {
  const ids: string[] = []
  const cleaned = path
    .split('/')
    .map((seg) => {
      const dot = seg.lastIndexOf('.')
      const ext = dot > 0 ? seg.slice(dot) : ''
      const stem = dot > 0 ? seg.slice(0, dot) : seg
      const { title, notionId } = splitNotionName(stem)
      if (notionId) ids.push(notionId)
      return `${title}${ext}`
    })
    .join('/')
  return { cleaned, ids }
}

/** Extract a Notion 32-hex page id from a (possibly URL-encoded) href or notion.so URL. */
export function extractNotionIdFromHref(href: string): string | null {
  let decoded = href
  try {
    decoded = decodeURIComponent(href)
  } catch {
    // keep raw on malformed escapes
  }
  const m = HREF_ID_RE.exec(decoded)
  return m ? m[1]!.toLowerCase() : null
}
