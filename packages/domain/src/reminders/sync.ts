import type { PrismaClient } from '@repo/db'

import { badRequest, forbidden } from '../errors.ts'
import type { DeliveryScheduler, ReminderForRebuild } from './ports.ts'
import type { SyncRemindersInput } from './schemas.ts'

export async function syncReminders(
  prisma: PrismaClient,
  actorUserId: string,
  input: SyncRemindersInput,
  scheduler: DeliveryScheduler,
): Promise<{ ok: true }> {
  const page = await prisma.page.findUniqueOrThrow({
    where: { id: input.pageId },
    select: { workspaceId: true },
  })

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: actorUserId } },
  })
  if (!member || !(['OWNER', 'ADMIN', 'EDITOR'] as string[]).includes(member.role)) {
    throw forbidden('Недостаточно прав')
  }

  // Validate LIST recipients are workspace members (security)
  const listRemindersWithRecipients = input.reminders.filter(
    (r) => r.audience === 'LIST' && r.recipients.length > 0,
  )
  if (listRemindersWithRecipients.length > 0) {
    const allRecipientIds = Array.from(
      new Set(listRemindersWithRecipients.flatMap((r) => r.recipients)),
    )
    const members = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: page.workspaceId,
        userId: { in: allRecipientIds },
      },
      select: { userId: true },
    })
    const memberSet = new Set(members.map((m) => m.userId))
    const invalid = allRecipientIds.filter((id) => !memberSet.has(id))
    if (invalid.length > 0) {
      throw badRequest(`Some recipients are not workspace members: ${invalid.join(', ')}`)
    }
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.reminder.findMany({
      where: { pageId: input.pageId },
      select: {
        id: true,
        deletedAt: true,
        doneAt: true,
        dueAt: true,
        offsets: true,
        audience: true,
        createdById: true,
      },
    })
    const existingById = new Map(existing.map((r) => [r.id, r]))
    const incomingIds = new Set(input.reminders.map((r) => r.id))

    for (const r of input.reminders) {
      const prev = existingById.get(r.id)
      await tx.reminder.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          pageId: input.pageId,
          workspaceId: page.workspaceId,
          createdById: actorUserId,
          dueAt: new Date(r.dueAt),
          offsets: r.offsets,
          audience: r.audience,
          label: r.label,
          doneAt: r.doneAt ? new Date(r.doneAt) : null,
          doneById: r.doneAt ? actorUserId : null,
        },
        update: {
          dueAt: new Date(r.dueAt),
          offsets: r.offsets,
          audience: r.audience,
          label: r.label,
          doneAt: r.doneAt ? new Date(r.doneAt) : null,
          deletedAt: null,
          doneById: r.doneAt && !prev?.doneAt ? actorUserId : undefined,
        },
      })

      await tx.reminderRecipient.deleteMany({ where: { reminderId: r.id } })
      if (r.audience === 'LIST' && r.recipients.length) {
        await tx.reminderRecipient.createMany({
          data: r.recipients.map((uid) => ({ reminderId: r.id, userId: uid })),
        })
      }

      const forRebuild: ReminderForRebuild = {
        id: r.id,
        pageId: input.pageId,
        workspaceId: page.workspaceId,
        createdById: prev?.createdById ?? actorUserId,
        dueAt: new Date(r.dueAt),
        offsets: r.offsets,
        audience: r.audience,
        label: r.label,
        recipients: r.recipients,
        doneAt: r.doneAt ? new Date(r.doneAt) : null,
      }
      await scheduler.rebuild(tx, forRebuild)
    }

    const toDelete = [...existingById.keys()].filter((id) => !incomingIds.has(id))
    if (toDelete.length) {
      await tx.reminder.updateMany({
        where: { id: { in: toDelete }, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      await scheduler.cancel(tx, toDelete, 'reminder removed')
    }
  })

  return { ok: true }
}
