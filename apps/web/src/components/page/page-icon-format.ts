// Page.icon discriminated format (Phase 9A, spec §1/§3):
//   plain string   -> emoji (back-compatible — today's data renders unchanged)
//   'url:<path>'   -> image icon ('/api/files/<id>' or an https URL)
// Pure helpers (no React/MUI imports) so unit tests can pin the format without
// pulling component dependencies.

export const PAGE_ICON_URL_PREFIX = 'url:'

/** The image URL when `icon` is an image icon, null for emoji/empty values. */
export function pageIconImageUrl(icon: string | null | undefined): string | null {
  if (!icon || !icon.startsWith(PAGE_ICON_URL_PREFIX)) return null
  const url = icon.slice(PAGE_ICON_URL_PREFIX.length)
  return url || null
}

/** Serializes an uploaded/linked image URL into the `Page.icon` format. */
export function pageIconValue(imageUrl: string): string {
  return `${PAGE_ICON_URL_PREFIX}${imageUrl}`
}
