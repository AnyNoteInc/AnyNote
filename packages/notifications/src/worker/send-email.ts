import { sendMailNow } from '@repo/mail'
import type { NotificationDelivery, NotificationEvent } from '@repo/db'

import { renderEmailForEvent } from '../templates/email.ts'

export type DeliveryWithEvent = NotificationDelivery & { event: NotificationEvent }

export async function sendDeliveryEmail(delivery: DeliveryWithEvent): Promise<void> {
  if (!delivery.targetEmail) {
    throw new Error(`sendDeliveryEmail: delivery ${delivery.id} has no target email`)
  }
  const rendered = renderEmailForEvent(
    delivery.event.type,
    (delivery.event.payload ?? {}) as Record<string, unknown>,
  )
  if (!rendered) {
    throw new Error(
      `sendDeliveryEmail: no email template for event type ${delivery.event.type}`,
    )
  }
  await sendMailNow({ kind: rendered.kind, to: delivery.targetEmail, data: rendered.data } as never)
}
