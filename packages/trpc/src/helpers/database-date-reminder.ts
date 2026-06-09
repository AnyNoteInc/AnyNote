import type { PrismaClient, Prisma } from '@repo/db'
import { DatabasePropertyType } from '@repo/db'
import {
  rebuildDatabaseDateReminderDeliveries,
  cancelDatabaseDateReminderDeliveries,
} from '@repo/notifications'

// Phase 5 (5.4) — shared materialization for self-targeted database DATE-cell
// reminders. Used by BOTH the `database.setDatabaseDateReminder` procedure and
// the `updateCellValue` reschedule path (when a DATE cell with reminder configs
// changes). The config CRUD lives in the procedures; this file only:
//   - resolves the DATABASE source context for a (pageId) + verifies the
//     property is a DATE property of that source and the row belongs to it;
//   - reads the DATE cell value for (rowId, propertyId);
//   - (re)builds the NotificationDelivery rows for a config via the reusable
//     `rebuildDatabaseDateReminderDeliveries` machinery (or cancels them when the
//     date is empty / the owner lost access).

type DatePropContext = {
  workspaceId: string
  sourceId: string
  propertyName: string
}

/**
 * Resolve + validate the (page, property, row) for a date reminder. Returns the
 * source context when the property is a DATE property of the page's source and
 * the row belongs to the same source (and is not deleted); else null.
 */
export async function resolveDatePropContext(
  prisma: PrismaClient,
  args: { pageId: string; propertyId: string; rowId: string },
): Promise<DatePropContext | null> {
  const source = await prisma.databaseSource.findUnique({
    where: { pageId: args.pageId },
    select: { id: true, workspaceId: true },
  })
  if (!source) return null

  const [prop, row] = await Promise.all([
    prisma.databaseProperty.findUnique({
      where: { id: args.propertyId },
      select: { sourceId: true, type: true, name: true },
    }),
    prisma.databaseRow.findUnique({
      where: { id: args.rowId },
      select: { sourceId: true, deletedAt: true },
    }),
  ])
  if (!prop || prop.sourceId !== source.id || prop.type !== DatabasePropertyType.DATE) return null
  if (!row || row.sourceId !== source.id || row.deletedAt !== null) return null

  return { workspaceId: source.workspaceId, sourceId: source.id, propertyName: prop.name }
}

/** Read the DATE cell value (an ISO string) for (rowId, propertyId), or null. */
export async function readDateCellValue(
  prisma: PrismaClient,
  rowId: string,
  propertyId: string,
): Promise<Date | null> {
  const cell = await prisma.databaseCellValue.findUnique({
    where: { rowId_propertyId: { rowId, propertyId } },
    select: { value: true },
  })
  const value = cell?.value
  if (typeof value !== 'string') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * (Re)build the delivery rows for ONE database date reminder config from the
 * current DATE cell value. When `dueAt` is null (the cell is empty) the
 * deliveries are cancelled. Runs inside a transaction (the delivery reconcile is
 * multi-write). The config row itself is upserted by the caller (the procedure)
 * BEFORE calling this so the config id is known.
 */
export async function rebuildConfigDeliveries(
  prisma: PrismaClient,
  config: {
    reminderId: string
    workspaceId: string
    pageId: string
    rowId: string
    propertyId: string
    userId: string
    offsetMinutes: number
    label: string | null
  },
  dueAt: Date | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await rebuildDatabaseDateReminderDeliveries(tx as unknown as Prisma.TransactionClient, {
      reminderId: config.reminderId,
      workspaceId: config.workspaceId,
      pageId: config.pageId,
      rowId: config.rowId,
      propertyId: config.propertyId,
      userId: config.userId,
      offsetMinutes: config.offsetMinutes,
      dueAt,
      label: config.label,
    })
  })
}

/** Cancel all pending deliveries for the given config ids (clear path). */
export async function cancelConfigDeliveries(
  prisma: PrismaClient,
  reminderIds: string[],
  reason: string,
): Promise<void> {
  if (reminderIds.length === 0) return
  await prisma.$transaction(async (tx) => {
    await cancelDatabaseDateReminderDeliveries(
      tx as unknown as Prisma.TransactionClient,
      reminderIds,
      reason,
    )
  })
}

/**
 * Reschedule (or cancel) all OWNERS' deliveries for a DATE cell that just
 * changed. Self-target only: a config is the OWNER's own; we rebuild each
 * owner's deliveries against the new cell value, but ONLY if they still have row
 * access (a config owner who lost access gets no content-bearing reminder —
 * their deliveries are cancelled instead). Side-effect only — never throws into
 * the cell-write caller.
 *
 * `canView(userId)` is injected (the domain row-access check) so this helper
 * stays in the tRPC tier without importing the domain root here.
 */
export async function rescheduleRemindersForDateCell(
  prisma: PrismaClient,
  args: {
    pageId: string
    propertyId: string
    rowId: string
    workspaceId: string
    propertyName: string
  },
  canView: (userId: string) => Promise<boolean>,
): Promise<void> {
  try {
    const configs = await prisma.databaseDateReminder.findMany({
      where: { rowId: args.rowId, propertyId: args.propertyId },
      select: { id: true, userId: true, offsetMinutes: true },
    })
    if (configs.length === 0) return

    const dueAt = await readDateCellValue(prisma, args.rowId, args.propertyId)

    for (const config of configs) {
      const stillHasAccess = await canView(config.userId)
      if (!stillHasAccess) {
        // The owner lost row access → cancel their pending reminders (no leak).
        await cancelConfigDeliveries(prisma, [config.id], 'owner lost row access')
        continue
      }
      await rebuildConfigDeliveries(
        prisma,
        {
          reminderId: config.id,
          workspaceId: args.workspaceId,
          pageId: args.pageId,
          rowId: args.rowId,
          propertyId: args.propertyId,
          userId: config.userId,
          offsetMinutes: config.offsetMinutes,
          label: args.propertyName,
        },
        dueAt,
      )
    }
  } catch (err) {
    console.error('[database] date-reminder reschedule failed', err)
  }
}
