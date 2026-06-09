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

// Allows a reminder saved just after a fire point to be picked up by the next dispatch tick.
const RECENT_PAST_DELIVERY_GRACE_MS = 60_000
const UNKNOWN_OFFSET_MINUTES = -1

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

function deliveryKey(
  userId: string,
  offsetMinutes: number,
  channel: string,
  targetSubscriptionId?: string | null,
): string {
  return [userId, offsetMinutes, channel, targetSubscriptionId ?? ''].join('|')
}

function readOffsetMinutes(payload: Prisma.JsonValue): number {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return UNKNOWN_OFFSET_MINUTES
  }

  const offsetMinutes = (payload as { offsetMinutes?: unknown }).offsetMinutes
  return typeof offsetMinutes === 'number' ? offsetMinutes : UNKNOWN_OFFSET_MINUTES
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

  const existingByKey = new Map<string, (typeof existing)[number]>()
  for (const d of existing) {
    existingByKey.set(
      deliveryKey(d.userId, readOffsetMinutes(d.event.payload), d.channel, d.targetSubscriptionId),
      d,
    )
  }

  const wantedKeys = new Set<string>()

  for (const offsetMinutes of r.offsets) {
    const fireAt = new Date(r.dueAt.getTime() - offsetMinutes * 60_000)
    if (fireAt.getTime() < now - RECENT_PAST_DELIVERY_GRACE_MS) continue

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
        return eventId
      }

      if (inAppWanted) {
        const k = deliveryKey(userId, offsetMinutes, 'IN_APP')
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
              channel: 'IN_APP',
              nextAttemptAt: fireAt,
            },
          })
        }
      }

      if (targets.email) {
        const k = deliveryKey(userId, offsetMinutes, 'EMAIL')
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
        const k = deliveryKey(userId, offsetMinutes, 'WEB_PUSH', sub.id)
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
    return !wantedKeys.has(
      deliveryKey(d.userId, readOffsetMinutes(d.event.payload), d.channel, d.targetSubscriptionId),
    )
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
  await tx.$executeRaw`
    UPDATE notification_deliveries d
    SET status = 'SKIPPED',
        processed_at = NOW(),
        last_error = ${reason},
        locked_at = NULL,
        locked_by = NULL
    FROM notification_events e
    WHERE d.event_id = e.id
      AND d.status = 'PENDING'
      AND e.type = 'REMINDER_DUE'
      AND e.payload->>'reminderId' = ANY(${reminderIds}::text[])
  `
}

// ── Database date reminders (Phase 5, 5.4) ───────────────────────────────────
//
// A self-targeted reminder anchored to a DATABASE row's DATE cell. It reuses the
// SAME `NotificationDelivery` machinery as page reminders (per-channel rows with
// `nextAttemptAt = dueAt - offsetMinutes`, dispatched by the notifier cron), but
// keyed on `databaseReminderId` in the `DATABASE_DATE_REMINDER` event payload —
// a parallel, focused builder so the page-reminder path stays untouched.
//
// The config (`DatabaseDateReminder`) is owned/upserted by the tRPC layer; THIS
// builder only (re)materializes the deliveries from {dueAt, offset, recipient}.

export type DatabaseDateReminderForRebuild = {
  /** The DatabaseDateReminder config row id (the delivery key). */
  reminderId: string
  workspaceId: string
  pageId: string
  rowId: string
  propertyId: string
  /** SELF-TARGET recipient (Notion parity — never another user). */
  userId: string
  offsetMinutes: number
  /** The DATE cell value, or null when the cell is empty (→ cancel deliveries). */
  dueAt: Date | null
  /** A human label for the reminder (e.g. the property name). */
  label: string | null
}

function dbReminderDeliveryKey(channel: string, targetSubscriptionId?: string | null): string {
  return [channel, targetSubscriptionId ?? ''].join('|')
}

/**
 * (Re)build the `NotificationDelivery` rows for ONE self-targeted database date
 * reminder, reusing the page-reminder delivery model (per-channel rows fired at
 * `dueAt - offsetMinutes`). Idempotent: existing PENDING deliveries for this
 * config are reconciled (kept/rescheduled), and any no-longer-wanted ones are
 * SKIPPED. When `dueAt` is null (the DATE cell is empty) ALL pending deliveries
 * for this config are cancelled and none are created.
 */
export async function rebuildDatabaseDateReminderDeliveries(
  tx: Tx,
  r: DatabaseDateReminderForRebuild,
): Promise<void> {
  // No date → nothing to fire; clear any leftovers.
  if (r.dueAt === null) {
    await cancelDatabaseDateReminderDeliveries(tx, [r.reminderId], 'date cell cleared')
    return
  }

  const descriptor = EVENT_CATALOG.DATABASE_DATE_REMINDER
  const now = Date.now()
  const fireAt = new Date(r.dueAt.getTime() - r.offsetMinutes * 60_000)

  const existing = await tx.notificationDelivery.findMany({
    where: {
      status: 'PENDING',
      userId: r.userId,
      event: {
        type: 'DATABASE_DATE_REMINDER',
        payload: { path: ['databaseReminderId'], equals: r.reminderId },
      },
    },
    include: { event: true },
  })
  const existingByKey = new Map<string, (typeof existing)[number]>()
  for (const d of existing) {
    existingByKey.set(dbReminderDeliveryKey(d.channel, d.targetSubscriptionId), d)
  }

  const wantedKeys = new Set<string>()

  // A fire point already (well) in the past is not scheduled — but we still
  // reconcile/cancel the existing rows below so a moved-into-the-past date is
  // not left firing.
  const inFuture = fireAt.getTime() >= now - RECENT_PAST_DELIVERY_GRACE_MS

  if (inFuture) {
    const targets = await resolvePreferences(tx, r.userId, descriptor)
    const inAppWanted =
      descriptor.defaultChannels.includes('IN_APP') || descriptor.lockedChannels.includes('IN_APP')

    let eventId: string | null = null
    const ensureEvent = async () => {
      if (eventId) return eventId
      const evt = await tx.notificationEvent.create({
        data: {
          type: 'DATABASE_DATE_REMINDER',
          category: descriptor.category,
          userId: r.userId,
          workspaceId: r.workspaceId,
          payload: {
            databaseReminderId: r.reminderId,
            pageId: r.pageId,
            rowId: r.rowId,
            propertyId: r.propertyId,
            workspaceId: r.workspaceId,
            offsetMinutes: r.offsetMinutes,
            dueAt: r.dueAt!.toISOString(),
            label: r.label,
          } as Prisma.InputJsonValue,
          resourceUrl: `/workspaces/${r.workspaceId}/pages/${r.pageId}`,
        },
      })
      eventId = evt.id
      return eventId
    }

    const reconcileChannel = async (
      channel: 'IN_APP' | 'EMAIL' | 'WEB_PUSH',
      extra: { targetEmail?: string; targetSubscriptionId?: string } = {},
    ) => {
      const k = dbReminderDeliveryKey(channel, extra.targetSubscriptionId ?? null)
      wantedKeys.add(k)
      const prev = existingByKey.get(k)
      if (prev) {
        if (prev.nextAttemptAt.getTime() !== fireAt.getTime()) {
          await tx.notificationDelivery.update({
            where: { id: prev.id },
            data: { nextAttemptAt: fireAt },
          })
        }
        return
      }
      const evtId = await ensureEvent()
      await tx.notificationDelivery.create({
        data: {
          eventId: evtId,
          userId: r.userId,
          channel,
          nextAttemptAt: fireAt,
          ...extra,
        },
      })
    }

    if (inAppWanted) await reconcileChannel('IN_APP')
    if (targets.email) await reconcileChannel('EMAIL', { targetEmail: targets.email })
    for (const sub of targets.pushSubscriptions) {
      await reconcileChannel('WEB_PUSH', { targetSubscriptionId: sub.id })
    }
  }

  const stale = existing.filter(
    (d) => !wantedKeys.has(dbReminderDeliveryKey(d.channel, d.targetSubscriptionId)),
  )
  if (stale.length) {
    await tx.notificationDelivery.updateMany({
      where: { id: { in: stale.map((d) => d.id) } },
      data: {
        status: 'SKIPPED',
        processedAt: new Date(),
        lastError: 'database date reminder configuration changed',
        lockedAt: null,
        lockedBy: null,
      },
    })
  }
}

/** Cancel all PENDING deliveries for the given database date reminder config ids. */
export async function cancelDatabaseDateReminderDeliveries(
  tx: Tx,
  reminderIds: string[],
  reason: string,
): Promise<void> {
  if (reminderIds.length === 0) return
  await tx.$executeRaw`
    UPDATE notification_deliveries d
    SET status = 'SKIPPED',
        processed_at = NOW(),
        last_error = ${reason},
        locked_at = NULL,
        locked_by = NULL
    FROM notification_events e
    WHERE d.event_id = e.id
      AND d.status = 'PENDING'
      AND e.type = 'DATABASE_DATE_REMINDER'
      AND e.payload->>'databaseReminderId' = ANY(${reminderIds}::text[])
  `
}
