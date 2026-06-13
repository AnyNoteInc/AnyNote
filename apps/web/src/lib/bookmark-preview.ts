/**
 * Pure HTML → bookmark-preview metadata parser (spec §4, invariant 2).
 *
 * Extracts a title, description, image, and favicon from a fetched page's HTML.
 * It runs over UNTRUSTED, attacker-controllable HTML (the bookmark-preview route
 * fetches an arbitrary safe-https URL), so it must:
 *  - NEVER throw (any malformed input ⇒ best-effort partial result),
 *  - cap every field length (title ≤200, description ≤400, urls ≤1024),
 *  - https-sanitize the image/favicon urls (drop javascript:/data:/http: —
 *    the values render browser-side as `<img src>`).
 *
 * Regex-based (not a DOM parse): the input is already length-capped (the route
 * reads ≤512KB) and we only need a handful of head tags. A real DOM parser would
 * pull a dependency and an attack surface we don't want server-side.
 */

const TITLE_MAX = 200
const DESC_MAX = 400
const URL_MAX = 1024

export type BookmarkPreviewMeta = {
  title?: string
  description?: string
  image?: string
  favicon?: string
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
}

/** Minimal HTML-entity decode for the named/numeric entities seen in meta text. */
function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (match, body: string) => {
    const lower = body.toLowerCase()
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isNaN(code) ? match : safeFromCodePoint(code, match)
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isNaN(code) ? match : safeFromCodePoint(code, match)
    }
    return NAMED_ENTITIES[lower] ?? match
  })
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (code < 0 || code > 0x10ffff) return fallback
  try {
    return String.fromCodePoint(code)
  } catch {
    return fallback
  }
}

function clean(value: string | undefined, max: number): string | undefined {
  if (value == null) return undefined
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim()
  if (text === '') return undefined
  return text.length > max ? text.slice(0, max) : text
}

/**
 * Resolve a candidate image/favicon URL against the page base and keep it ONLY
 * if it is an https URL within the length cap. A protocol-relative `//host/x`
 * resolves against the https base ⇒ https. Anything else (javascript:, data:,
 * http:, mailto:, unparseable) is dropped.
 */
function sanitizeAssetUrl(raw: string | undefined, baseUrl: string): string | undefined {
  if (raw == null) return undefined
  const candidate = decodeEntities(raw).trim()
  if (candidate === '') return undefined
  let resolved: URL
  try {
    resolved = new URL(candidate, baseUrl)
  } catch {
    return undefined
  }
  if (resolved.protocol !== 'https:') return undefined
  const href = resolved.toString()
  if (href.length > URL_MAX) return undefined
  return href
}

/** First capture group of the first matching `<meta>` for a property/name key. */
function metaContent(html: string, key: string): string | undefined {
  // Tolerate attribute order: content-before-property and property-before-content.
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const propThenContent = new RegExp(
    `<meta[^>]*\\b(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`,
    'i',
  )
  const contentThenProp = new RegExp(
    `<meta[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\b(?:property|name)\\s*=\\s*["']${escaped}["']`,
    'i',
  )
  return propThenContent.exec(html)?.[1] ?? contentThenProp.exec(html)?.[1] ?? undefined
}

function titleTag(html: string): string | undefined {
  return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? undefined
}

/** First `<link rel="...icon...">` href (rel is a space-separated token list). */
function faviconHref(html: string): string | undefined {
  const linkRe = /<link\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html)) !== null) {
    const tag = match[0]
    const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
    if (rel == null) continue
    const tokens = rel.toLowerCase().split(/\s+/)
    if (!tokens.includes('icon') && !tokens.includes('shortcut')) continue
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
    if (href) return href
  }
  return undefined
}

export function parseMeta(html: string, baseUrl: string): BookmarkPreviewMeta {
  const meta: BookmarkPreviewMeta = {}

  const title = clean(metaContent(html, 'og:title') ?? titleTag(html), TITLE_MAX)
  if (title) meta.title = title

  const description = clean(metaContent(html, 'og:description'), DESC_MAX)
  if (description) meta.description = description

  const image = sanitizeAssetUrl(metaContent(html, 'og:image'), baseUrl)
  if (image) meta.image = image

  const favicon = sanitizeAssetUrl(faviconHref(html), baseUrl)
  if (favicon) meta.favicon = favicon

  return meta
}
