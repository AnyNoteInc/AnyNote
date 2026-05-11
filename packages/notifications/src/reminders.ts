import type { Prisma, ReminderAudience } from '@repo/db'

import { EVENT_CATALOG } from './catalog.ts'
import { resolvePreferences } from './resolve-preferences.ts'

const HUMAN_OFFSETS: Record<number, string> = {
  0: 'в момент истечения',
  60: '1 час',
  1440: '1 день',
  4320: '3 дня',
  10080: '1 неделя',
  43200: '1 месяц',
}

export function formatHumanOffset(minutes: number): string {
  return HUMAN_OFFSETS[minutes] ?? 'напоминание'
}

type Tx = Prisma.TransactionClient

export type ReminderForRebuild = {
  id: string
  pageId: string
  workspaceId: string
  createdById: string | null
  dueAt: Date
  offsets: number[]
  audience: ReminderAudience
  label: string | null
  recipients: string[]
  doneAt: Date | null
}

async function resolveRecipientUserIds(tx: Tx, r: ReminderForRebuild): Promise<string[]> {
  if (r.audience === 'ME') return r.createdById ? [r.createdById] : []
  if (r.audience === 'WORKSPACE') {
    const members = await tx.workspaceMember.findMany({
      where: { workspaceId: r.workspaceId },
      select: { userId: true },
    })
    return members.map((m) => m.userId)
  }
  return r.recipients
}

export async function rebuildDeliveries(tx: Tx, r: ReminderForRebuild): Promise<void> {
  if (r.doneAt) {
    await cancelPendingDeliveries(tx, [r.id], 'reminder completed')
    return
  }

  const recipientIds = await resolveRecipientUserIds(tx, r)
  if (recipientIds.length === 0) {
    await cancelPendingDeliveries(tx, [r.id], 'no recipients')
    return
  }

  const descriptor = EVENT_CATALOG.REMINDER_DUE
  const now = Date.now()

  const existing = await tx.notificationDelivery.findMany({
    where: {
      status: 'PENDING',
      event: {
        type: 'REMINDER_DUE',
        payload: { path: ['reminderId'], equals: r.id },
      },
    },
    include: { event: true },
  })

  type Key = string
  const keyOf = (userId: string, offsetMinutes: number, channel: string): Key =>
    `${userId}|${offsetMinutes}|${channel}`
  const existingByKey = new Map<Key, (typeof existing)[number]>()
  for (const d of existing) {
    const payload = d.event.payload as { offsetMinutes?: number }
    const off = typeof payload?.offsetMinutes === 'number' ? payload.offsetMinutes : -1
    existingByKey.set(keyOf(d.userId, off, d.channel), d)
  }

  const wantedKeys = new Set<Key>()

  for (const offsetMinutes of r.offsets) {
    const fireAt = new Date(r.dueAt.getTime() - offsetMinutes * 60_000)
    if (fireAt.getTime() < now - 60_000) continue

    for (const userId of recipientIds) {
      const targets = await resolvePreferences(tx, userId, descriptor)
      const inAppWanted =
        descriptor.defaultChannels.includes('IN_APP') ||
        descriptor.lockedChannels.includes('IN_APP')

      let eventId: string | null = null
      const ensureEvent = async () => {
        if (eventId) return eventId
        const evt = await tx.notificationEvent.create({
          data: {
            type: 'REMINDER_DUE',
            category: descriptor.category,
            userId,
            workspaceId: r.workspaceId,
            payload: {
              reminderId: r.id,
              pageId: r.pageId,
              workspaceId: r.workspaceId,
              offsetMinutes,
              dueAt: r.dueAt.toISOString(),
              label: r.label,
            } as Prisma.InputJsonValue,
            resourceUrl: `/workspaces/${r.workspaceId}/pages/${r.pageId}#reminder-${r.id}`,
          },
        })
        eventId = evt.id
        if (inAppWanted) {
          await tx.notificationInApp.create({ data: { eventId: evt.id, userId } })
        }
        return eventId
      }

      if (targets.email) {
        const k = keyOf(userId, offsetMinutes, 'EMAIL')
        wantedKeys.add(k)
        const prev = existingByKey.get(k)
        if (prev) {
          if (prev.nextAttemptAt.getTime() !== fireAt.getTime()) {
            await tx.notificationDelivery.update({
              where: { id: prev.id },
              data: { nextAttemptAt: fireAt },
            })
          }
        } else {
          const evtId = await ensureEvent()
          await tx.notificationDelivery.create({
            data: {
              eventId: evtId,
              userId,
              channel: 'EMAIL',
              targetEmail: targets.email,
              nextAttemptAt: fireAt,
            },
          })
        }
      }

      for (const sub of targets.pushSubscriptions) {
        const k = keyOf(userId, offsetMinutes, 'WEB_PUSH')
        wantedKeys.add(k)
        const prev = existingByKey.get(k)
        if (prev) {
          if (prev.nextAttemptAt.getTime() !== fireAt.getTime()) {
            await tx.notificationDelivery.update({
              where: { id: prev.id },
              data: { nextAttemptAt: fireAt },
            })
          }
        } else {
          const evtId = await ensureEvent()
          await tx.notificationDelivery.create({
            data: {
              eventId: evtId,
              userId,
              channel: 'WEB_PUSH',
              targetSubscriptionId: sub.id,
              nextAttemptAt: fireAt,
            },
          })
        }
      }
    }
  }

  const stale = existing.filter((d) => {
    const payload = d.event.payload as { offsetMinutes?: number }
    const off = typeof payload?.offsetMinutes === 'number' ? payload.offsetMinutes : -1
    return !wantedKeys.has(keyOf(d.userId, off, d.channel))
  })
  if (stale.length) {
    await tx.notificationDelivery.updateMany({
      where: { id: { in: stale.map((d) => d.id) } },
      data: {
        status: 'SKIPPED',
        processedAt: new Date(),
        lastError: 'reminder configuration changed',
        lockedAt: null,
        lockedBy: null,
      },
    })
  }
}

export async function cancelPendingDeliveries(
  tx: Tx,
  reminderIds: string[],
  reason: string,
): Promise<void> {
  if (reminderIds.length === 0) return
  await tx.notificationDelivery.updateMany({
    where: {
      status: 'PENDING',
      event: {
        is: {
          type: 'REMINDER_DUE',
          OR: reminderIds.map((id) => ({
            payload: { path: ['reminderId'], equals: id },
          })),
        },
      },
    },
    data: {
      status: 'SKIPPED',
      processedAt: new Date(),
      lastError: reason,
      lockedAt: null,
      lockedBy: null,
    },
  })
}
