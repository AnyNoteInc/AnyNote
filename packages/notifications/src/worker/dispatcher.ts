import type { PrismaClient } from '@repo/db'

import { lockPendingDeliveries } from './lock.ts'
import { sendDeliveryEmail, type DeliveryWithEvent } from './send-email.ts'
import {
  sendDeliveryWebPush,
  GoneSubscriptionError,
  type DeliveryWithEventAndSub,
} from './send-web-push.ts'

const BACKOFF_BASE_MS = 60_000
const BACKOFF_CAP_MS = 30 * 60_000

function nextAttemptAt(attempts: number): Date {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS)
  return new Date(Date.now() + delay)
}

export async function isReminderEventStillValid(
  prisma: PrismaClient,
  event: { type: string; payload: unknown },
): Promise<boolean> {
  if (event.type !== 'REMINDER_DUE') return true
  const payload = event.payload as { reminderId?: string }
  if (!payload?.reminderId) return false
  const r = await prisma.reminder.findUnique({
    where: { id: payload.reminderId },
    select: { deletedAt: true, doneAt: true },
  })
  if (!r) return false
  return r.deletedAt === null && r.doneAt === null
}

export type DispatcherOpts = { workerId: string; batchSize: number; maxAttempts: number }

export async function runDispatcherTick(
  prisma: PrismaClient,
  opts: DispatcherOpts,
): Promise<void> {
  const ids = await lockPendingDeliveries(prisma, {
    workerId: opts.workerId,
    batchSize: opts.batchSize,
  })
  if (ids.length === 0) return

  await Promise.allSettled(
    ids.map(async (id) => {
      const delivery = await prisma.notificationDelivery.findUnique({
        where: { id },
        include: { event: true, targetSubscription: true },
      })
      if (!delivery) return
      const stillValid = await isReminderEventStillValid(prisma, delivery.event)
      if (!stillValid) {
        await prisma.notificationDelivery.update({
          where: { id },
          data: {
            status: 'SKIPPED',
            processedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: 'reminder no longer valid',
          },
        })
        return
      }
      try {
        if (delivery.channel === 'EMAIL') {
          await sendDeliveryEmail(delivery as unknown as DeliveryWithEvent)
        } else if (delivery.channel === 'WEB_PUSH') {
          await sendDeliveryWebPush(delivery as unknown as DeliveryWithEventAndSub)
        }
        await prisma.notificationDelivery.update({
          where: { id },
          data: {
            status: 'DELIVERED',
            processedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
          },
        })
      } catch (err) {
        const isGone = err instanceof GoneSubscriptionError
        if (isGone && delivery.targetSubscriptionId) {
          await prisma.pushSubscription
            .delete({ where: { id: delivery.targetSubscriptionId } })
            .catch(() => undefined)
        }
        const attempts = delivery.attempts + 1
        const isTerminal = isGone || attempts >= opts.maxAttempts
        await prisma.notificationDelivery.update({
          where: { id },
          data: {
            status: isTerminal ? 'FAILED' : 'PENDING',
            attempts,
            nextAttemptAt: isTerminal ? delivery.nextAttemptAt : nextAttemptAt(attempts),
            lockedAt: null,
            lockedBy: null,
            lastError: String(err instanceof Error ? err.message : err),
          },
        })
      }
    }),
  )
}
