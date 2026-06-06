// Matches a leading URI scheme like `https:`, `mailto:`, `tel:`, `ftp:`.
// Per RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/**
 * Normalizes a raw, user-entered link target into a safe href.
 *
 * - Empty / whitespace-only -> '' (caller removes the link).
 * - Already has a scheme (https:, mailto:, tel:, ...) -> left as-is.
 * - Root / relative path (/, ./, ../) or in-page anchor (#) -> left as-is.
 * - Anything else (a bare domain like `example.com`) -> prefixed with `https://`.
 */
export function normalizeLinkHref(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (SCHEME_RE.test(trimmed)) return trimmed
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.')) {
    return trimmed
  }
  return `https://${trimmed}`
}
