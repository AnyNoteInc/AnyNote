import { describe, expect, it } from 'vitest'
import { buildDesktopUserAgent } from '../src/main/user-agent'

describe('buildDesktopUserAgent', () => {
  const base = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36'
  it('appends an AnyNote-Desktop token with version/platform/arch', () => {
    const ua = buildDesktopUserAgent(base, { version: '1.2.0', platform: 'darwin', arch: 'arm64' })
    expect(ua.startsWith(base)).toBe(true)
    expect(ua).toContain('AnyNote-Desktop/1.2.0')
    expect(ua).toContain('(darwin; arm64)')
  })
  it('produces a UA that the web parser can detect as desktop', () => {
    const ua = buildDesktopUserAgent(base, { version: '1.2.0', platform: 'win32', arch: 'x64' })
    expect(/AnyNote-Desktop\/[\d.]+/.test(ua)).toBe(true)
  })
})
