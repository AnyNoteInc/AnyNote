import { describe, expect, it } from 'vitest'

import { parseUserAgent } from '@/lib/parse-user-agent'

describe('parseUserAgent — desktop client', () => {
  it('labels the AnyNote desktop UA as a desktop app with OS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36 AnyNote-Desktop/1.2.0 (darwin; arm64)'
    expect(parseUserAgent(ua)).toEqual({ browser: 'AnyNote Desktop', os: 'macOS' })
  })
  it('maps win32 desktop UA to Windows', () => {
    const ua = 'Mozilla/5.0 Chrome/130 AnyNote-Desktop/1.0.0 (win32; x64)'
    expect(parseUserAgent(ua)).toEqual({ browser: 'AnyNote Desktop', os: 'Windows' })
  })
  it('maps linux desktop UA to Linux', () => {
    const ua = 'Mozilla/5.0 Chrome/130 AnyNote-Desktop/1.0.0 (linux; x64)'
    expect(parseUserAgent(ua)).toEqual({ browser: 'AnyNote Desktop', os: 'Linux' })
  })
  it('still parses a normal browser UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Chrome', os: 'Windows' })
  })
})
