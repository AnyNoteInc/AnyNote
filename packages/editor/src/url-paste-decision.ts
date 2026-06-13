// Pure decision logic for the bare-URL paste chooser (spec §4). Extracted from
// the ProseMirror plugin so the "which options for which URL" rule is unit-
// tested without a DOM. The plugin (url-paste.ts) only wires these decisions to
// the editor + the inline menu.

import { resolveEmbed } from './embed-providers'

/**
 * True when `text` is a single, bare http(s) URL (no surrounding words). Only
 * such a paste triggers the chooser; "see https://x.com now" stays a plain text
 * paste, and a text-selection paste (handled by the plugin) stays a link.
 */
export const isBareUrl = (text: string): boolean => {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}

export type UrlPasteOption =
  | { kind: 'link' }
  | { kind: 'bookmark' }
  | { kind: 'embed'; provider: string; embedUrl: string }

/**
 * The chooser options for a pasted URL, in display order:
 *  - «Ссылка» (link)     — always, for any bare safe URL
 *  - «Закладка» (bookmark) — always, for any bare safe URL
 *  - «Встроить» (embed)  — only when the URL resolves to an allowlisted embed
 * Returns [] for a non-bare or unsafe input (the plugin then does nothing
 * special and lets the default paste run).
 */
export const urlPasteOptions = (text: string): UrlPasteOption[] => {
  if (!isBareUrl(text)) return []
  const options: UrlPasteOption[] = [{ kind: 'link' }, { kind: 'bookmark' }]
  const embed = resolveEmbed(text.trim())
  if (embed) {
    options.push({ kind: 'embed', provider: embed.provider, embedUrl: embed.embedUrl })
  }
  return options
}
