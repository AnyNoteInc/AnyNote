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
  const payload = event.payload as {
    reminderId?: string
    dueAt?: string
    offsetMinutes?: number
  }
  if (!payload?.reminderId) return false
  const r = await prisma.reminder.findUnique({
    where: { id: payload.reminderId },
    select: {
      deletedAt: true,
      doneAt: true,
      dueAt: true,
      offsets: true,
      page: { select: { deletedAt: true } },
    },
  })
  if (!r) return false
  if (r.deletedAt !== null) return false
  if (r.doneAt !== null) return false
  if (r.page.deletedAt !== null) return false
  if (typeof payload.dueAt !== 'string') return false
  if (new Date(payload.dueAt).getTime() !== r.dueAt.getTime()) return false
  if (typeof payload.offsetMinutes !== 'number') return false
  if (!r.offsets.includes(payload.offsetMinutes)) return false
  return true
}

/**
 * Fire-time validity for a DATABASE_DATE_REMINDER delivery (Phase 5, 5.4).
 *
 * Mirrors `isReminderEventStillValid` but for a self-targeted database date
 * reminder. Two responsibilities:
 *  1. The config still exists, still points at the same date+offset, and its
 *     row/page are not deleted (so a moved/cleared date or a deleted row never
 *     fires a stale reminder).
 *  2. CRITICAL — the target user STILL has access to the row. A user who lost
 *     row access (e.g. a PERSON/CREATED_BY access rule no longer matches them)
 *     must NOT receive this content-bearing reminder.
 *
 * `@repo/notifications` sits BELOW `@repo/domain` in the architecture tiers and
 * cannot import the domain row-access resolver, so the row-access check is a
 * self-contained re-implementation over `@repo/db` of the same rule semantics
 * (broad access for OWNER/ADMIN/source-page-creator OR no enabled rules; else a
 * PERSON/CREATED_BY rule must match the viewer). It mirrors
 * `DatabaseService.canUserViewRow` — keep the two in sync if the rule model
 * changes.
 */
export async function isDatabaseDateReminderEventStillValid(
  prisma: PrismaClient,
  event: { type: string; userId: string; payload: unknown },
): Promise<boolean> {
  if (event.type !== 'DATABASE_DATE_REMINDER') return true
  const payload = event.payload as {
    databaseReminderId?: string
    rowId?: string
    propertyId?: string
    pageId?: string
    dueAt?: string
    offsetMinutes?: number
  }
  if (!payload?.databaseReminderId) return false

  const config = await prisma.databaseDateReminder.findUnique({
    where: { id: payload.databaseReminderId },
    select: {
      userId: true,
      propertyId: true,
      rowId: true,
      pageId: true,
      offsetMinutes: true,
    },
  })
  if (!config) return false
  // Self-target invariant: the delivery's user must be the config owner.
  if (config.userId !== event.userId) return false
  if (typeof payload.offsetMinutes === 'number' && payload.offsetMinutes !== config.offsetMinutes) {
    return false
  }

  // The row + its DATE cell must still resolve to the scheduled fire date.
  const row = await prisma.databaseRow.findUnique({
    where: { id: config.rowId },
    select: {
      deletedAt: true,
      sourceId: true,
      createdById: true,
      source: { select: { workspaceId: true, pageId: true } },
      page: { select: { deletedAt: true } },
    },
  })
  if (!row) return false
  if (row.deletedAt !== null) return false
  if (row.page.deletedAt !== null) return false

  const cell = await prisma.databaseCellValue.findUnique({
    where: { rowId_propertyId: { rowId: config.rowId, propertyId: config.propertyId } },
    select: { value: true },
  })
  const cellValue = cell?.value
  if (typeof cellValue !== 'string') return false
  const dueAt = new Date(cellValue)
  if (Number.isNaN(dueAt.getTime())) return false
  // The payload's dueAt must still match the cell (the date wasn't moved).
  if (typeof payload.dueAt === 'string' && new Date(payload.dueAt).getTime() !== dueAt.getTime()) {
    return false
  }

  // ── Access re-check (self-contained, mirrors canUserViewRow) ────────────────
  return canUserStillViewRow(prisma, event.userId, row.source.workspaceId, row.sourceId, {
    rowCreatedById: row.createdById,
    rowId: config.rowId,
  })
}

/**
 * Self-contained row-access re-check over `@repo/db` (the notifications package
 * cannot import the domain resolver). Returns true if `userId` may still VIEW
 * the row:
 *  - non-member of the workspace → false;
 *  - OWNER/ADMIN, or the source page creator → true (broad access);
 *  - no enabled access rules on the source → true (every member sees every row);
 *  - else true only if a PERSON rule's cell value === userId OR a CREATED_BY
 *    rule and the row was created by userId.
 */
async function canUserStillViewRow(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
  sourceId: string,
  row: { rowCreatedById: string | null; rowId: string },
): Promise<boolean> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!member) return false
  if (member.role === 'OWNER' || member.role === 'ADMIN') return true

  const source = await prisma.databaseSource.findUnique({
    where: { id: sourceId },
    select: { page: { select: { createdById: true } } },
  })
  if (source?.page.createdById === userId) return true

  const rules = await prisma.databasePageAccessRule.findMany({
    where: { sourceId, enabled: true },
    select: { propertyId: true, property: { select: { type: true } } },
  })
  if (rules.length === 0) return true

  for (const rule of rules) {
    if (rule.property.type === 'CREATED_BY') {
      if (row.rowCreatedById === userId) return true
    } else if (rule.property.type === 'PERSON') {
      const cell = await prisma.databaseCellValue.findUnique({
        where: { rowId_propertyId: { rowId: row.rowId, propertyId: rule.propertyId } },
        select: { value: true },
      })
      if (cell?.value === userId) return true
    }
  }
  return false
}

export type DispatcherOpts = { workerId: string; batchSize: number; maxAttempts: number }

export async function runDispatcherTick(prisma: PrismaClient, opts: DispatcherOpts): Promise<void> {
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
      const stillValid =
        (await isReminderEventStillValid(prisma, delivery.event)) &&
        (await isDatabaseDateReminderEventStillValid(prisma, {
          type: delivery.event.type,
          userId: delivery.userId,
          payload: delivery.event.payload,
        }))
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
        if (delivery.channel === 'IN_APP') {
          await prisma.notificationInApp.upsert({
            where: { eventId: delivery.eventId },
            create: { eventId: delivery.eventId, userId: delivery.userId },
            update: {},
          })
        } else if (delivery.channel === 'EMAIL') {
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
