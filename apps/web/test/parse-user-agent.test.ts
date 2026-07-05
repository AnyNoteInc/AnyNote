import { describe, expect, it } from 'vitest'

import { parseUserAgent } from '@/lib/parse-user-agent'

describe('parseUserAgent', () => {
  it('parses a Chrome on Windows UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Chrome', os: 'Windows' })
  })
  it('parses a Safari on macOS UA', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Safari', os: 'macOS' })
  })
  it('returns Unknown for an empty UA', () => {
    expect(parseUserAgent(null)).toEqual({ browser: 'Unknown', os: 'Unknown' })
  })
})
