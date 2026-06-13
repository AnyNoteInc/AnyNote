import { describe, expect, it } from 'vitest'

import { isBareUrl, urlPasteOptions } from './url-paste-decision'

describe('isBareUrl', () => {
  it('accepts a single http(s) URL with no surrounding text', () => {
    expect(isBareUrl('https://example.com')).toBe(true)
    expect(isBareUrl('http://example.com/path?q=1')).toBe(true)
    expect(isBareUrl('  https://example.com  ')).toBe(true)
  })

  it('rejects multi-token text even if it contains a URL', () => {
    expect(isBareUrl('see https://example.com now')).toBe(false)
    expect(isBareUrl('https://a.com https://b.com')).toBe(false)
  })

  it('rejects plain words and empty input', () => {
    expect(isBareUrl('hello')).toBe(false)
    expect(isBareUrl('')).toBe(false)
    expect(isBareUrl('   ')).toBe(false)
  })

  it('rejects non-http(s) schemes (javascript:, mailto:, data:)', () => {
    expect(isBareUrl('javascript:alert(1)')).toBe(false)
    expect(isBareUrl('mailto:a@b.com')).toBe(false)
    expect(isBareUrl('data:text/html,x')).toBe(false)
  })

  it('rejects a raw iframe paste', () => {
    expect(isBareUrl('<iframe src="https://x.com"></iframe>')).toBe(false)
  })
})

describe('urlPasteOptions', () => {
  it('offers link + bookmark for any safe URL, and embed when the URL is allowlisted', () => {
    const opts = urlPasteOptions('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(opts.map((o) => o.kind)).toEqual(['link', 'bookmark', 'embed'])
  })

  it('omits embed for a non-allowlisted URL', () => {
    const opts = urlPasteOptions('https://example.com/article')
    expect(opts.map((o) => o.kind)).toEqual(['link', 'bookmark'])
  })

  it('returns no options for a non-bare / unsafe input', () => {
    expect(urlPasteOptions('hello world')).toEqual([])
    expect(urlPasteOptions('javascript:alert(1)')).toEqual([])
    expect(urlPasteOptions('')).toEqual([])
  })

  it('threads the resolved embedUrl onto the embed option', () => {
    const opts = urlPasteOptions('https://vimeo.com/123456789')
    const embed = opts.find((o) => o.kind === 'embed')
    expect(embed?.provider).toBe('vimeo')
    expect(embed?.embedUrl).toContain('player.vimeo.com/video/123456789')
  })
})
