// Matches a leading URI scheme like `https:`, `mailto:`, `tel:`, `ftp:`.
// Per RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

// Schemes that can execute script or smuggle markup. Blocked outright.
const UNSAFE_SCHEME_RE = /^(?:javascript|data|vbscript):/i

/**
 * Normalizes a raw, user-entered link target into a safe href.
 *
 * - Empty / whitespace-only -> '' (caller removes the link).
 * - Dangerous scheme (javascript:, data:, vbscript:) -> '' (caller removes the link).
 * - Already has a scheme (https:, mailto:, tel:, ...) -> left as-is.
 * - Root / relative path (/, ./, ../) or in-page anchor (#) -> left as-is.
 * - Anything else (a bare domain like `example.com`) -> prefixed with `https://`.
 */
export function normalizeLinkHref(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (UNSAFE_SCHEME_RE.test(trimmed)) return ''
  if (SCHEME_RE.test(trimmed)) return trimmed
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.')) {
    return trimmed
  }
  return `https://${trimmed}`
}

// Pin the Link extension's current target/rel defaults so a future Tiptap
// change can't silently drop rel (reverse-tabnabbing protection). Shared by
// every `Link.configure` site (both editors + the server HTML export) so the
// rendered anchor attributes can't drift between them.
export const LINK_HTML_ATTRIBUTES = {
  target: '_blank',
  rel: 'noopener noreferrer nofollow',
} as const
