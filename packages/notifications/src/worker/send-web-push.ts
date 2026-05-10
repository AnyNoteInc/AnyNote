import webpush from 'web-push'
import type { NotificationDelivery, NotificationEvent, PushSubscription } from '@repo/db'

import { renderPushPayload } from '../templates/push.ts'

export class GoneSubscriptionError extends Error {
  constructor(public endpoint: string) {
    super(`Push subscription gone: ${endpoint}`)
    this.name = 'GoneSubscriptionError'
  }
}

let vapidConfigured = false
function ensureVapid(): void {
  if (vapidConfigured) return
  const subject = process.env.VAPID_SUBJECT
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!subject || !pub || !priv) {
    throw new Error('VAPID env vars missing: VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY')
  }
  webpush.setVapidDetails(subject, pub, priv)
  vapidConfigured = true
}

export type DeliveryWithEventAndSub = NotificationDelivery & {
  event: NotificationEvent
  targetSubscription: PushSubscription | null
}

export async function sendDeliveryWebPush(delivery: DeliveryWithEventAndSub): Promise<void> {
  if (!delivery.targetSubscription) {
    throw new Error(`sendDeliveryWebPush: delivery ${delivery.id} has no target subscription`)
  }
  ensureVapid()
  const payload = renderPushPayload(
    delivery.event.type,
    (delivery.event.payload ?? {}) as Record<string, unknown>,
    delivery.event.resourceUrl,
  )
  if (!payload) {
    throw new Error(`sendDeliveryWebPush: no push payload for event ${delivery.event.type}`)
  }
  const sub = delivery.targetSubscription
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: payload.title, body: payload.body, url: payload.url }),
    )
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 410 || status === 404) {
      throw new GoneSubscriptionError(sub.endpoint)
    }
    throw err
  }
}
