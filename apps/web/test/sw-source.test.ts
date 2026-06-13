import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// File-content guard for the service worker (a static asset with no build
// step, so no runtime harness): pins the push handlers, the conservative
// shell-cache contract, and the privacy-critical '/api/' exclusion.
const swSource = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8')

describe('public/sw.js source contract', () => {
  it('declares SW_VERSION and the versioned shell cache', () => {
    expect(swSource).toContain('const SW_VERSION')
    expect(swSource).toContain('anynote-shell-v')
  })

  it('precaches exactly the offline page, the brand icon and the manifest', () => {
    const match = swSource.match(/const PRECACHE_PATHS = (\[[^\]]*\])/)
    expect(match).not.toBeNull()
    expect(JSON.parse(match![1]!.replace(/'/g, '"'))).toEqual([
      '/offline',
      '/icon',
      '/manifest.webmanifest',
    ])
  })

  it('never intercepts /api/ traffic (the exclusion guard is present)', () => {
    expect(swSource).toContain("url.pathname.startsWith('/api/')")
  })

  it('only considers GET requests', () => {
    expect(swSource).toContain("request.method !== 'GET'")
  })

  it('handles navigations (network-first with the /offline fallback)', () => {
    expect(swSource).toContain("request.mode === 'navigate'")
    expect(swSource).toContain("caches.match('/offline')")
  })

  it('serves precached statics from the Request key, cache-first', () => {
    // Match the original Request (scope-robust, matches the addAll keys) rather
    // than the bare pathname.
    expect(swSource).toContain('caches.match(request)')
    expect(swSource).not.toContain('caches.match(url.pathname)')
  })

  it('never re-caches precached statics at runtime (install-time addAll is the sole write path)', () => {
    // The only cache.put must be absent: a runtime miss falls through to the
    // network and is NOT persisted, so a session-influenced render can't leak
    // into the shell cache.
    expect(swSource).not.toContain('cache.put')
  })

  it('keeps the push and notificationclick handlers', () => {
    expect(swSource).toContain("addEventListener('push'")
    expect(swSource).toContain("addEventListener('notificationclick'")
    expect(swSource).toContain('showNotification')
  })

  it("references the real '/icon' route, never the broken '/icon.png'", () => {
    expect(swSource).toContain("'/icon'")
    expect(swSource).not.toContain('/icon.png')
  })
})
