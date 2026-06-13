// Embed provider allowlist (spec §4 + §7 invariant 1). PURE — no React, no
// Tiptap. The single authority deciding whether a pasted URL may become an
// `<iframe>` and, if so, WHICH provider-owned URL the iframe src must be.
//
// SECURITY: the embed src is ALWAYS a value produced here (a provider-owned host
// we hardcode), NEVER the raw pasted URL. `resolveEmbed` returns null for
// anything not on the allowlist, so a non-allowlisted/lookalike/unsafe URL can
// never reach an iframe. The host match is exact-or-registrable-suffix (a dot
// boundary), NOT a substring — so `youtube.com.evil.com`, `notyoutube.com`,
// `youtube.com@evil.com`, and `evil.com/youtube.com/...` all FAIL.

export type EmbedProvider = {
  /** Stable id used as the embed node's `provider` attr and in tests. */
  id: string
  /**
   * The accepted hostnames for this provider. Each entry is matched as either an
   * EXACT hostname or a registrable-domain SUFFIX with a leading-dot boundary
   * (`vimeo.com` accepts `vimeo.com` and `player.vimeo.com`, but never
   * `notvimeo.com` or `vimeo.com.evil.com`). Listed hosts are the canonical
   * watch/share hosts a user pastes, NOT the embed host.
   */
  hosts: string[]
  /**
   * Transforms a parsed, https, host-verified URL into the provider's own embed
   * URL. Returns null when the URL is on the right host but isn't an embeddable
   * resource (e.g. a youtube channel page, not a video). The returned URL's host
   * is hardcoded here — it is never derived from the input host.
   */
  toEmbedUrl: (url: URL) => string | null
}

/**
 * True when `host` is `accepted` exactly, or a subdomain of `accepted` at a real
 * label boundary. The leading dot prevents the classic suffix-confusion attacks:
 * `evil-vimeo.com`.endsWith('vimeo.com') would be true, but
 * `evil-vimeo.com`.endsWith('.vimeo.com') is false.
 */
const hostMatches = (host: string, accepted: string): boolean =>
  host === accepted || host.endsWith(`.${accepted}`)

const findProvider = (host: string): EmbedProvider | null =>
  EMBED_PROVIDERS.find((p) => p.hosts.some((h) => hostMatches(host, h))) ?? null

// ── Per-provider embed-URL builders ─────────────────────────────────────────
// Each is handed an already-validated URL (https, host on the provider's list).

const youtubeId = (url: URL): string | null => {
  // youtu.be/<id>
  if (hostMatches(url.hostname, 'youtu.be')) {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id ?? null
  }
  // youtube.com/watch?v=<id>
  const v = url.searchParams.get('v')
  if (v) return v
  // youtube.com/embed/<id> or /shorts/<id> or /live/<id>
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') {
    return parts[1] ?? null
  }
  return null
}

const ID_RE = /^[A-Za-z0-9_-]+$/

export const EMBED_PROVIDERS: EmbedProvider[] = [
  {
    id: 'youtube',
    hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    toEmbedUrl: (url) => {
      const id = youtubeId(url)
      if (!id || !ID_RE.test(id)) return null
      // youtube-nocookie is the privacy-preserving embed host.
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`
    },
  },
  {
    id: 'vimeo',
    hosts: ['vimeo.com'],
    toEmbedUrl: (url) => {
      // vimeo.com/<numericId>  (player.vimeo.com is the embed host)
      const id = url.pathname.split('/').filter(Boolean)[0]
      if (!id || !/^\d+$/.test(id)) return null
      return `https://player.vimeo.com/video/${id}`
    },
  },
  {
    id: 'rutube',
    hosts: ['rutube.ru'],
    toEmbedUrl: (url) => {
      // rutube.ru/video/<id>/  →  rutube.ru/play/embed/<id>
      const parts = url.pathname.split('/').filter(Boolean)
      const idx = parts.indexOf('video')
      const id = idx >= 0 ? parts[idx + 1] : parts[0]
      if (!id || !ID_RE.test(id)) return null
      return `https://rutube.ru/play/embed/${id}`
    },
  },
  {
    id: 'vk',
    hosts: ['vk.com', 'vkvideo.ru'],
    toEmbedUrl: (url) => {
      // vk.com/video<oid>_<vid>  →  vk.com/video_ext.php?oid=<oid>&id=<vid>
      const parts = url.pathname.split('/').filter(Boolean)
      const last = parts[parts.length - 1] ?? ''
      const m = last.match(/^video(-?\d+)_(\d+)$/)
      if (!m) return null
      const [, oid, vid] = m
      return `https://vk.com/video_ext.php?oid=${oid}&id=${vid}&hd=2`
    },
  },
  {
    id: 'dailymotion',
    hosts: ['dailymotion.com', 'dai.ly'],
    toEmbedUrl: (url) => {
      let id: string | undefined
      if (hostMatches(url.hostname, 'dai.ly')) {
        id = url.pathname.split('/').filter(Boolean)[0]
      } else {
        const parts = url.pathname.split('/').filter(Boolean)
        const idx = parts.indexOf('video')
        id = idx >= 0 ? parts[idx + 1] : undefined
      }
      // Dailymotion ids are alphanumeric; strip any trailing slug after `_`.
      const clean = id?.split('_')[0]
      if (!clean || !ID_RE.test(clean)) return null
      return `https://www.dailymotion.com/embed/video/${clean}`
    },
  },
  {
    id: 'loom',
    hosts: ['loom.com'],
    toEmbedUrl: (url) => {
      // loom.com/share/<id>  →  loom.com/embed/<id>
      const parts = url.pathname.split('/').filter(Boolean)
      const idx = parts.indexOf('share')
      const id = idx >= 0 ? parts[idx + 1] : parts[0]
      if (!id || !ID_RE.test(id)) return null
      return `https://www.loom.com/embed/${id}`
    },
  },
  {
    id: 'figma',
    hosts: ['figma.com'],
    toEmbedUrl: (url) => {
      // figma.com/file|design|proto/...  →  figma.com/embed?embed_host=...&url=<full>
      const parts = url.pathname.split('/').filter(Boolean)
      if (!['file', 'design', 'proto', 'board'].includes(parts[0] ?? '')) return null
      return `https://www.figma.com/embed?embed_host=anynote&url=${encodeURIComponent(url.toString())}`
    },
  },
  {
    id: 'codepen',
    hosts: ['codepen.io'],
    toEmbedUrl: (url) => {
      // codepen.io/<user>/pen/<id>  →  codepen.io/<user>/embed/<id>
      const parts = url.pathname.split('/').filter(Boolean)
      const penIdx = parts.indexOf('pen')
      if (penIdx <= 0) return null
      const user = parts[penIdx - 1]
      const id = parts[penIdx + 1]
      if (!user || !id || !ID_RE.test(id)) return null
      return `https://codepen.io/${encodeURIComponent(user)}/embed/${encodeURIComponent(id)}`
    },
  },
  {
    id: 'soundcloud',
    hosts: ['soundcloud.com'],
    toEmbedUrl: (url) => {
      // soundcloud.com/<artist>/<track>  →  w.soundcloud.com/player/?url=<full>
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length < 1) return null
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.toString())}&visual=true`
    },
  },
  {
    id: 'gmaps',
    hosts: ['google.com', 'maps.google.com', 'goo.gl'],
    toEmbedUrl: (url) => {
      // Only the /maps surface embeds; require a maps path.
      const isMapsHost = hostMatches(url.hostname, 'maps.google.com')
      const isMapsPath = url.pathname.startsWith('/maps')
      if (!isMapsHost && !isMapsPath) return null
      // The keyless embed via the maps `q`/place output param.
      const q = url.searchParams.get('q') ?? extractPlace(url.pathname)
      if (!q) return null
      return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`
    },
  },
]

const extractPlace = (pathname: string): string | null => {
  // /maps/place/<query>/...  → the query segment
  const parts = pathname.split('/').filter(Boolean)
  const idx = parts.indexOf('place')
  const place = idx >= 0 ? parts[idx + 1] : undefined
  return place ? decodeURIComponent(place) : null
}

export type ResolvedEmbed = { provider: string; embedUrl: string }

/**
 * Decide whether `raw` may become an embed and, if so, the provider-owned embed
 * URL its iframe src must use. Returns null for ANY non-allowlisted, lookalike,
 * non-https, or unparseable URL — the security boundary for invariant 1.
 */
export const resolveEmbed = (raw: string): ResolvedEmbed | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // Raw `<iframe>` paste, garbage, protocol-relative `//host` — all unparseable
    // as an absolute URL, so all rejected here.
    return null
  }
  // https ONLY — no javascript:/data:/http:/ftp:.
  if (url.protocol !== 'https:') return null
  const provider = findProvider(url.hostname)
  if (!provider) return null
  const embedUrl = provider.toEmbedUrl(url)
  if (!embedUrl) return null
  // Belt-and-suspenders: the produced URL must itself be https (the builders
  // hardcode https, but pin it so a future edit can't regress invariant 1).
  if (!embedUrl.startsWith('https://')) return null
  return { provider: provider.id, embedUrl }
}
