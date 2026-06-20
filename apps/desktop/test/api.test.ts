import { describe, expect, it } from 'vitest'
import { buildAnynoteApi } from '../src/preload/api'

describe('buildAnynoteApi', () => {
  it('exposes isDesktop, platform, arch, appVersion', () => {
    const api = buildAnynoteApi({ platform: 'darwin', arch: 'arm64', version: '1.2.0' })
    expect(api).toEqual({ isDesktop: true, platform: 'darwin', arch: 'arm64', appVersion: '1.2.0' })
  })
  it('returns a frozen object (cannot be tampered by the remote site)', () => {
    const api = buildAnynoteApi({ platform: 'linux', arch: 'x64', version: '1.0.0' })
    expect(Object.isFrozen(api)).toBe(true)
  })
})
