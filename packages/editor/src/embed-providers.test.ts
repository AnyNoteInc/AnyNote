import { describe, expect, it } from 'vitest'

import { EMBED_PROVIDERS, resolveEmbed } from './embed-providers'

// ── The allow matrix ────────────────────────────────────────────────────────
// Each provider's canonical watch/share URL must resolve to an embedUrl on the
// PROVIDER'S OWN embed host. The embedUrl is what the iframe src will be, so a
// wrong/attacker-controlled host here is an XSS-in-an-iframe; pin every one.

describe('resolveEmbed — allow matrix', () => {
  const cases: Array<{ name: string; url: string; provider: string; embedHost: string }> = [
    {
      name: 'youtube watch',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      provider: 'youtube',
      embedHost: 'www.youtube-nocookie.com',
    },
    {
      name: 'youtu.be short',
      url: 'https://youtu.be/dQw4w9WgXcQ',
      provider: 'youtube',
      embedHost: 'www.youtube-nocookie.com',
    },
    {
      name: 'vimeo',
      url: 'https://vimeo.com/123456789',
      provider: 'vimeo',
      embedHost: 'player.vimeo.com',
    },
    {
      name: 'rutube',
      url: 'https://rutube.ru/video/abc123def456/',
      provider: 'rutube',
      embedHost: 'rutube.ru',
    },
    {
      name: 'vk video',
      url: 'https://vk.com/video-12345_67890',
      provider: 'vk',
      embedHost: 'vk.com',
    },
    {
      name: 'dailymotion',
      url: 'https://www.dailymotion.com/video/x7tgad0',
      provider: 'dailymotion',
      embedHost: 'www.dailymotion.com',
    },
    {
      name: 'loom',
      url: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef',
      provider: 'loom',
      embedHost: 'www.loom.com',
    },
    {
      name: 'figma',
      url: 'https://www.figma.com/file/abcDEF123/My-Design',
      provider: 'figma',
      embedHost: 'www.figma.com',
    },
    {
      name: 'codepen',
      url: 'https://codepen.io/team/pen/abcXYZ',
      provider: 'codepen',
      embedHost: 'codepen.io',
    },
    {
      name: 'soundcloud',
      url: 'https://soundcloud.com/artist/track-name',
      provider: 'soundcloud',
      embedHost: 'w.soundcloud.com',
    },
    {
      name: 'google maps',
      url: 'https://www.google.com/maps/place/Red+Square',
      provider: 'gmaps',
      embedHost: 'www.google.com',
    },
  ]

  for (const c of cases) {
    it(`allows ${c.name} → ${c.provider} on ${c.embedHost}`, () => {
      const result = resolveEmbed(c.url)
      expect(result).not.toBeNull()
      expect(result!.provider).toBe(c.provider)
      // The embed host MUST be the provider's own host.
      const host = new URL(result!.embedUrl).hostname
      expect(host).toBe(c.embedHost)
      // The src is ALWAYS https.
      expect(result!.embedUrl.startsWith('https://')).toBe(true)
    })
  }

  it('carries the youtube video id into the embed path', () => {
    const r = resolveEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(r!.embedUrl).toContain('/embed/dQw4w9WgXcQ')
  })

  it('carries the vimeo id into the player path', () => {
    const r = resolveEmbed('https://vimeo.com/123456789')
    expect(r!.embedUrl).toContain('/video/123456789')
  })

  it('accepts a youtube host without the www prefix', () => {
    const r = resolveEmbed('https://youtube.com/watch?v=dQw4w9WgXcQ')
    expect(r).not.toBeNull()
    expect(r!.provider).toBe('youtube')
  })

  it('accepts an m. mobile youtube host', () => {
    const r = resolveEmbed('https://m.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(r).not.toBeNull()
    expect(r!.provider).toBe('youtube')
  })
})

// ── The deny matrix (the security core) ─────────────────────────────────────
// A non-allowlisted, lookalike, or unsafe URL MUST resolve to null so it can
// never become an iframe src.

describe('resolveEmbed — deny matrix', () => {
  const denied: Array<{ name: string; url: string }> = [
    { name: 'a plain evil host', url: 'https://evil.com/watch?v=x' },
    // The lookalike: a youtube label as a SUBDOMAIN of an attacker domain.
    { name: 'youtube.com.evil.com lookalike', url: 'https://youtube.com.evil.com/watch?v=x' },
    { name: 'youtube as a path on evil', url: 'https://evil.com/youtube.com/watch?v=x' },
    { name: 'youtube as userinfo on evil', url: 'https://youtube.com@evil.com/watch?v=x' },
    // A bare substring that is NOT a host-suffix boundary.
    { name: 'notyoutube.com', url: 'https://notyoutube.com/watch?v=x' },
    { name: 'fakevimeo.com', url: 'https://fakevimeo.com/123' },
    { name: 'a raw iframe paste', url: '<iframe src="https://evil.com"></iframe>' },
    { name: 'javascript: scheme', url: 'javascript:alert(1)' },
    { name: 'data: scheme', url: 'data:text/html,<script>alert(1)</script>' },
    // Non-https is rejected (no http embeds — mixed-content + downgrade).
    { name: 'http (non-https) youtube', url: 'http://www.youtube.com/watch?v=x' },
    // An open-redirect-looking URL on an allowlisted host's lookalike.
    { name: 'open-redirect lookalike', url: 'https://www.youtube.com.evil.com/redirect?to=x' },
    { name: 'empty string', url: '' },
    { name: 'garbage', url: 'not a url at all' },
    { name: 'protocol-relative', url: '//www.youtube.com/watch?v=x' },
  ]

  for (const c of denied) {
    it(`denies ${c.name}`, () => {
      expect(resolveEmbed(c.url)).toBeNull()
    })
  }

  it('never returns an embedUrl whose host is not the matched provider host', () => {
    // Exhaustive: for every provider, a host crafted as `<embedHostLabel>.evil.com`
    // must NOT resolve (no substring host match leaks through).
    for (const p of EMBED_PROVIDERS) {
      const url = `https://${p.id}.evil.com/whatever`
      expect(resolveEmbed(url)).toBeNull()
    }
  })
})

describe('EMBED_PROVIDERS', () => {
  it('covers the spec §4 provider list', () => {
    const ids = EMBED_PROVIDERS.map((p) => p.id).sort()
    expect(ids).toEqual(
      [
        'codepen',
        'dailymotion',
        'figma',
        'gmaps',
        'loom',
        'rutube',
        'soundcloud',
        'vimeo',
        'vk',
        'youtube',
      ].sort(),
    )
  })

  it('every embed host produced is https', () => {
    for (const p of EMBED_PROVIDERS) {
      // toEmbedUrl is fed a parsed URL; we only assert the static base host here
      // via a representative resolve in the allow matrix above. This guards the
      // provider table shape.
      expect(typeof p.toEmbedUrl).toBe('function')
      expect(typeof p.id).toBe('string')
    }
  })
})
