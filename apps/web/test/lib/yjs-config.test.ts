// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setLocation = (href: string) => {
  // jsdom forbids assigning window.location, but `Object.defineProperty`
  // works for our test URL parsing needs (we only read protocol/host).
  const url = new URL(href)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...window.location,
      href,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
    },
  })
}

describe('resolveYjsUrl', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns wss://<host>/ws when the page is HTTPS and the baked env is the dev fallback', async () => {
    vi.stubEnv('NEXT_PUBLIC_YJS_URL', 'ws://localhost:1234')
    setLocation('https://anynote.ru/workspaces/abc/pages/def')

    const { resolveYjsUrl } = await import('@/lib/yjs-config')

    expect(resolveYjsUrl()).toBe('wss://anynote.ru/ws')
  })

  it('returns wss://<host>/ws when the page is HTTPS and NEXT_PUBLIC_YJS_URL is unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_YJS_URL', '')
    setLocation('https://example.com/page')

    const { resolveYjsUrl } = await import('@/lib/yjs-config')

    expect(resolveYjsUrl()).toBe('wss://example.com/ws')
  })

  it('preserves an explicitly configured wss:// URL on HTTPS pages', async () => {
    vi.stubEnv('NEXT_PUBLIC_YJS_URL', 'wss://yjs.example.com')
    setLocation('https://anynote.ru/page')

    const { resolveYjsUrl } = await import('@/lib/yjs-config')

    expect(resolveYjsUrl()).toBe('wss://yjs.example.com')
  })

  it('uses the baked URL on HTTP pages (local dev)', async () => {
    vi.stubEnv('NEXT_PUBLIC_YJS_URL', 'ws://localhost:1234')
    setLocation('http://localhost:3000/page')

    const { resolveYjsUrl } = await import('@/lib/yjs-config')

    expect(resolveYjsUrl()).toBe('ws://localhost:1234')
  })
})
