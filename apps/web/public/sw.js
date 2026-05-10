/* eslint-env serviceworker */

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
    icon: '/icon.png',
    badge: '/icon.png',
    data: { url: data.url || '/notifications' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/notifications'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = all.find((c) => c.url.includes(url))
      if (open) return open.focus()
      return self.clients.openWindow(url)
    })(),
  )
})
