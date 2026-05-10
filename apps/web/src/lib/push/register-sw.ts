'use client'

import { urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from './vapid'

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

export type SerializedSubscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function subscribePush(): Promise<SerializedSubscription | null> {
  if (!VAPID_PUBLIC_KEY) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY missing')
  if (typeof window === 'undefined') return null
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null

  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker())
  if (!reg) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  return { endpoint: json.endpoint, keys: json.keys }
}

export async function unsubscribePush(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  await sub?.unsubscribe()
}
