// Doc-level "rich embeds" toggle (spec §4, cl9 line 157). LOCAL per-viewer —
// stored in localStorage keyed by pageId, never in Yjs.
// When OFF, the embed NodeView renders a bookmark-style card instead of an
// iframe. Default is ON. PURE-ish: only touches localStorage, guarded so SSR /
// privacy-mode (where storage throws or is absent) falls back to the default.

const PREFIX = 'anynote:embeds:'

export const embedsPrefKey = (pageId: string): string => `${PREFIX}${pageId}`

/** True unless the user has explicitly turned embeds OFF for this page. */
export const readEmbedsEnabled = (pageId: string): boolean => {
  try {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem(embedsPrefKey(pageId)) !== 'off'
  } catch {
    return true
  }
}

export const writeEmbedsEnabled = (pageId: string, enabled: boolean): void => {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(embedsPrefKey(pageId), enabled ? 'on' : 'off')
    // Notify same-tab listeners (the storage event only fires cross-tab).
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('anynote:embeds-pref', { detail: { pageId, enabled } }))
    }
  } catch {
    // Privacy mode / storage disabled — silently keep the in-session default.
  }
}
