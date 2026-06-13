import { describe, expect, it } from 'vitest'

import { parseMeta } from '../src/lib/bookmark-preview'

const BASE = 'https://example.com/articles/intro'

describe('parseMeta — og tags present', () => {
  it('extracts og:title/description/image and a favicon', () => {
    const html = `
      <html><head>
        <title>Plain Title</title>
        <meta property="og:title" content="OG Title" />
        <meta property="og:description" content="A great article about things." />
        <meta property="og:image" content="https://cdn.example.com/cover.png" />
        <link rel="icon" href="https://example.com/favicon.ico" />
      </head><body></body></html>`
    expect(parseMeta(html, BASE)).toEqual({
      title: 'OG Title',
      description: 'A great article about things.',
      image: 'https://cdn.example.com/cover.png',
      favicon: 'https://example.com/favicon.ico',
    })
  })

  it('supports name="..." form of the og meta tags', () => {
    const html = `<head>
      <meta name="og:title" content="Named OG Title" />
      <meta name="og:description" content="Named description" />
    </head>`
    const meta = parseMeta(html, BASE)
    expect(meta.title).toBe('Named OG Title')
    expect(meta.description).toBe('Named description')
  })
})

describe('parseMeta — og absent falls back to <title>', () => {
  it('uses <title> when og:title is missing', () => {
    const html = `<html><head><title>Just A Title</title></head><body></body></html>`
    const meta = parseMeta(html, BASE)
    expect(meta.title).toBe('Just A Title')
    expect(meta.description).toBeUndefined()
    expect(meta.image).toBeUndefined()
  })

  it('returns an empty object for HTML with no metadata', () => {
    expect(parseMeta('<html><body><p>nope</p></body></html>', BASE)).toEqual({})
  })

  it('decodes HTML entities in extracted text', () => {
    const html = `<title>Tom &amp; Jerry &lt;3</title>`
    expect(parseMeta(html, BASE).title).toBe('Tom & Jerry <3')
  })
})

describe('parseMeta — image/favicon sanitization (https-only)', () => {
  it('drops a javascript: image url', () => {
    const html = `<meta property="og:image" content="javascript:alert(1)" />`
    expect(parseMeta(html, BASE).image).toBeUndefined()
  })

  it('drops an http:// (non-https) image url', () => {
    const html = `<meta property="og:image" content="http://insecure.example.com/x.png" />`
    expect(parseMeta(html, BASE).image).toBeUndefined()
  })

  it('drops a data: image url', () => {
    const html = `<meta property="og:image" content="data:image/png;base64,AAAA" />`
    expect(parseMeta(html, BASE).image).toBeUndefined()
  })

  it('resolves a protocol-relative image url to https', () => {
    const html = `<meta property="og:image" content="//cdn.example.com/x.png" />`
    expect(parseMeta(html, BASE).image).toBe('https://cdn.example.com/x.png')
  })
})

describe('parseMeta — favicon resolution', () => {
  it('resolves a relative favicon href to an absolute https url against the base', () => {
    const html = `<link rel="icon" href="/static/favicon.png" />`
    expect(parseMeta(html, BASE).favicon).toBe('https://example.com/static/favicon.png')
  })

  it('resolves a relative path against the base directory', () => {
    const html = `<link rel="shortcut icon" href="icon.ico" />`
    expect(parseMeta(html, BASE).favicon).toBe('https://example.com/articles/icon.ico')
  })

  it('drops a favicon that resolves to a non-https url', () => {
    const html = `<link rel="icon" href="http://example.com/favicon.ico" />`
    // base is https so a relative resolves https; an explicit http href is dropped
    expect(parseMeta(html, BASE).favicon).toBeUndefined()
  })

  it('matches rel="icon" case-insensitively and among multiple rel tokens', () => {
    const html = `<link rel="ICON shortcut" href="/fav.png" />`
    expect(parseMeta(html, BASE).favicon).toBe('https://example.com/fav.png')
  })
})

describe('parseMeta — length caps', () => {
  it('truncates the title to 200 chars', () => {
    const long = 'a'.repeat(500)
    const meta = parseMeta(`<title>${long}</title>`, BASE)
    expect(meta.title).toHaveLength(200)
  })

  it('truncates the description to 400 chars', () => {
    const long = 'b'.repeat(900)
    const meta = parseMeta(`<meta property="og:description" content="${long}" />`, BASE)
    expect(meta.description).toHaveLength(400)
  })

  it('drops an image url longer than 1024 chars', () => {
    const longUrl = `https://example.com/${'x'.repeat(1100)}.png`
    const meta = parseMeta(`<meta property="og:image" content="${longUrl}" />`, BASE)
    expect(meta.image).toBeUndefined()
  })
})

describe('parseMeta — robustness', () => {
  it('never throws on malformed/empty input', () => {
    expect(() => parseMeta('', BASE)).not.toThrow()
    expect(() => parseMeta('<title>', BASE)).not.toThrow()
    expect(() => parseMeta('not html at all', BASE)).not.toThrow()
    expect(parseMeta('', BASE)).toEqual({})
  })

  it('ignores an empty title', () => {
    expect(parseMeta('<title>   </title>', BASE).title).toBeUndefined()
  })
})
