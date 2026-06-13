// AnyNote service worker: web push + a conservative app-shell cache.
// Same URL/scope as the original push-only worker so existing push
// subscriptions keep working across updates.
//
// SW_VERSION change-checklist: bump whenever sw.js OR any precached route
// (/offline, /icon, /manifest.webmanifest) changes — otherwise returning
// users keep serving a stale shell from the old versioned cache, since the
// activate handler only purges caches whose name !== the current SHELL_CACHE.
const SW_VERSION = 1
const SHELL_CACHE = `anynote-shell-v${SW_VERSION}`
const PRECACHE_PATHS = ['/offline', '/icon', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(PRECACHE_PATHS)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith('anynote-shell-') && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Only same-origin GET requests are ever considered.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Never intercept or cache API traffic: anything under '/api/' carries
  // private data and must always go straight to the network, untouched.
  if (url.pathname.startsWith('/api/')) return

  // Precached shell statics: cache-first. Install-time `cache.addAll` is the
  // sole write path; a runtime miss just falls through to the network and is
  // NOT re-cached. That keeps a session-influenced render of e.g. `/offline`
  // (fetched live after a cache eviction) from being persisted into the shell.
  if (PRECACHE_PATHS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        return fetch(request)
      })(),
    )
    return
  }

  // Page navigations: network-first with the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request)
        } catch (error) {
          const offline = await caches.match('/offline')
          if (offline) return offline
          throw error
        }
      })(),
    )
  }
  // Everything else (subresources, cross-origin, non-GET) is left to the
  // browser: no respondWith, no caching.
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = {}
  }
  const title = data.title || 'Уведомление'
  const options = {
    body: data.body || '',
    icon: '/icon',
    badge: '/icon',
    data: { url: data.url || '/notifications' },
  }
  event.waitUntil(globalThis.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/notifications'
  event.waitUntil(
    (async () => {
      const all = await globalThis.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const open = all.find((c) => c.url.includes(url))
      if (open) return open.focus()
      return globalThis.clients.openWindow(url)
    })(),
  )
})
