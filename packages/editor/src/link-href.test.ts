import { describe, expect, it } from 'vitest'

import { normalizeLinkHref } from './link-href'

describe('normalizeLinkHref', () => {
  it('leaves an explicit https/http scheme unchanged', () => {
    expect(normalizeLinkHref('https://example.com')).toBe('https://example.com')
    expect(normalizeLinkHref('http://example.com/path?q=1')).toBe('http://example.com/path?q=1')
  })

  it('prefixes https:// for a bare domain', () => {
    expect(normalizeLinkHref('example.com')).toBe('https://example.com')
    expect(normalizeLinkHref('www.example.com/path')).toBe('https://www.example.com/path')
  })

  it('leaves other known schemes unchanged', () => {
    expect(normalizeLinkHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(normalizeLinkHref('tel:+1234567890')).toBe('tel:+1234567890')
    expect(normalizeLinkHref('ftp://host/file')).toBe('ftp://host/file')
  })

  it('leaves relative paths and in-page anchors unchanged', () => {
    expect(normalizeLinkHref('/absolute/path')).toBe('/absolute/path')
    expect(normalizeLinkHref('./relative')).toBe('./relative')
    expect(normalizeLinkHref('../up')).toBe('../up')
    expect(normalizeLinkHref('#section')).toBe('#section')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeLinkHref('  https://example.com  ')).toBe('https://example.com')
    expect(normalizeLinkHref('  example.com ')).toBe('https://example.com')
  })

  it('returns empty string for empty or whitespace-only input', () => {
    expect(normalizeLinkHref('')).toBe('')
    expect(normalizeLinkHref('   ')).toBe('')
  })
})
