import type { PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import type {
  CompleteReminderInput,
  CreateReminderInput,
  DeleteReminderInput,
  MoveReminderInput,
} from './schemas.ts'
import type { DeliveryScheduler, ReminderForRebuild } from './ports.ts'

function shiftMs(shift: { days?: number; hours?: number; minutes?: number }): number {
  return (shift.days ?? 0) * 86_400_000 + (shift.hours ?? 0) * 3_600_000 + (shift.minutes ?? 0) * 60_000
}

async function assertPageAccess(prisma: PrismaClient, userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId } } } },
  })
  if (!page) throw notFound('Страница не найдена')
  return page
}

export async function createReminder(
  prisma: PrismaClient,
  actorUserId: string,
  input: CreateReminderInput,
  scheduler: DeliveryScheduler,
): Promise<{ reminderId: string }> {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)

  return prisma.$transaction(async (tx) => {
    const reminder = await tx.reminder.create({
      data: {
        pageId: input.pageId,
        workspaceId: page.workspaceId,
        createdById: actorUserId,
        label: input.label ?? null,
        dueAt: input.dueAt,
        audience: input.audience,
        offsets: input.offsets,
      },
      select: {
        id: true,
        pageId: true,
        workspaceId: true,
        createdById: true,
        dueAt: true,
        offsets: true,
        audience: true,
        label: true,
        doneAt: true,
      },
    })

    const forRebuild: ReminderForRebuild = {
      id: reminder.id,
      pageId: reminder.pageId,
      workspaceId: reminder.workspaceId,
      createdById: reminder.createdById,
      dueAt: reminder.dueAt,
      offsets: reminder.offsets,
      audience: reminder.audience,
      label: reminder.label,
      recipients: [],
      doneAt: null,
    }
    await scheduler.rebuild(tx, forRebuild)
    return { reminderId: reminder.id }
  })
}

export async function moveReminder(
  prisma: PrismaClient,
  actorUserId: string,
  input: MoveReminderInput,
  scheduler: DeliveryScheduler,
): Promise<{ id: string; dueAt: Date }> {
  const existing = await prisma.reminder.findUnique({
    where: { id: input.reminderId },
    select: { id: true, pageId: true, workspaceId: true, createdById: true, dueAt: true, offsets: true, audience: true, label: true, doneAt: true },
  })
  if (!existing || existing.createdById !== actorUserId) throw notFound('Напоминание не найдено')

  const newDueAt = input.dueAt ?? new Date(existing.dueAt.getTime() + shiftMs(input.shift ?? {}))

  return prisma.$transaction(async (tx) => {
    await tx.reminder.update({
      where: { id: input.reminderId },
      data: { dueAt: newDueAt },
    })

    const recipients = await tx.reminderRecipient.findMany({
      where: { reminderId: input.reminderId },
      select: { userId: true },
    })

    const forRebuild: ReminderForRebuild = {
      id: existing.id,
      pageId: existing.pageId,
      workspaceId: existing.workspaceId,
      createdById: existing.createdById,
      dueAt: newDueAt,
      offsets: existing.offsets,
      audience: existing.audience,
      label: existing.label,
      recipients: recipients.map((r) => r.userId),
      doneAt: existing.doneAt,
    }
    await scheduler.rebuild(tx, forRebuild)
    return { id: input.reminderId, dueAt: newDueAt }
  })
}

export async function deleteReminder(
  prisma: PrismaClient,
  actorUserId: string,
  input: DeleteReminderInput,
  scheduler: DeliveryScheduler,
): Promise<{ count: number }> {
  // Replicate original engines where-clause: support reminderId, reminderIds[], and pageId.
  // `all` stays in the input type for tool compatibility but, as in the original, is not used
  // in the where — when no ids and no pageId the where matches all of the user's active reminders.
  const ids = [...(input.reminderId ? [input.reminderId] : []), ...(input.reminderIds ?? [])]
  const where = {
    createdById: actorUserId,
    deletedAt: null,
    ...(ids.length ? { id: { in: ids } } : {}),
    ...(input.pageId ? { pageId: input.pageId } : {}),
  }
  return prisma.$transaction(async (tx) => {
    const matched = await tx.reminder.findMany({ where, select: { id: true } })
    const matchedIds = matched.map((r) => r.id)
    const result = await tx.reminder.updateMany({ where, data: { deletedAt: new Date() } })
    if (matchedIds.length) await scheduler.cancel(tx, matchedIds, 'reminder removed')
    return { count: result.count }
  })
}

export async function completeReminder(
  prisma: PrismaClient,
  actorUserId: string,
  input: CompleteReminderInput,
  scheduler: DeliveryScheduler,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.reminder.updateMany({
      where: {
        id: input.reminderId,
        doneAt: null,
        OR: [{ createdById: actorUserId }, { recipients: { some: { userId: actorUserId } } }],
      },
      data: { doneAt: new Date(), doneById: actorUserId },
    })
    if (result.count === 0) throw notFound('Напоминание не найдено')
    await scheduler.cancel(tx, [input.reminderId], 'reminder completed')
    return { id: input.reminderId }
  })
}
