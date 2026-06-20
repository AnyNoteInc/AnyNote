export const DEFAULT_SERVER_URL = 'https://anynote.ru'

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return DEFAULT_SERVER_URL
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

export function isValidServerUrl(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed === '') return false
  // Reject any explicit scheme that is not http(s); otherwise the missing-scheme
  // path would wrap e.g. "ftp://x" into "https://ftp://x" and wrongly pass.
  const explicitScheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (explicitScheme && !/^https?$/i.test(explicitScheme[1]!)) return false
  try {
    const url = new URL(normalizeServerUrl(trimmed))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
