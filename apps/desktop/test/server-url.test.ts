import { describe, expect, it } from 'vitest'
import { isValidServerUrl, normalizeServerUrl, DEFAULT_SERVER_URL } from '../src/main/server-url'

describe('normalizeServerUrl', () => {
  it('defaults to anynote.ru when given empty input', () => {
    expect(normalizeServerUrl('')).toBe('https://anynote.ru')
    expect(DEFAULT_SERVER_URL).toBe('https://anynote.ru')
  })
  it('adds https:// when scheme is missing', () => {
    expect(normalizeServerUrl('example.com')).toBe('https://example.com')
  })
  it('preserves an explicit http:// scheme (self-host LAN)', () => {
    expect(normalizeServerUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })
  it('strips a trailing slash', () => {
    expect(normalizeServerUrl('https://anynote.ru/')).toBe('https://anynote.ru')
  })
  it('trims whitespace', () => {
    expect(normalizeServerUrl('  https://anynote.ru  ')).toBe('https://anynote.ru')
  })
})

describe('isValidServerUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isValidServerUrl('https://anynote.ru')).toBe(true)
    expect(isValidServerUrl('http://localhost:3000')).toBe(true)
  })
  it('rejects non-http schemes and garbage', () => {
    expect(isValidServerUrl('ftp://x')).toBe(false)
    expect(isValidServerUrl('not a url')).toBe(false)
    expect(isValidServerUrl('')).toBe(false)
  })
})
