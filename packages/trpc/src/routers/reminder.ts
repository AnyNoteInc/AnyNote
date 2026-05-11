import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'
import { router, protectedProcedure } from '../trpc'
import {
  rebuildDeliveries,
  cancelPendingDeliveries,
  type ReminderForRebuild,
} from '@repo/notifications'

async function assertRole(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
  allowed: Array<'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' | 'GUEST'>,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || !allowed.includes(member.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return member
}

const reminderSyncSchema = z.object({
  id: z.string().uuid(),
  dueAt: z.string().datetime(),
  offsets: z.array(z.number().int().min(0).max(525_600)).max(20),
  audience: z.enum(['ME', 'WORKSPACE', 'LIST']),
  label: z.string().max(200).nullable(),
  recipients: z.array(z.string().uuid()).max(100),
  doneAt: z.string().datetime().nullable(),
})

export const reminderRouter = router({
  syncForPage: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        reminders: z.array(reminderSyncSchema).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findUniqueOrThrow({
        where: { id: input.pageId },
        select: { workspaceId: true },
      })
      await assertRole(ctx, page.workspaceId, ['OWNER', 'ADMIN', 'EDITOR'])

      await ctx.prisma.$transaction(async (tx) => {
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
              createdById: ctx.user.id,
              dueAt: new Date(r.dueAt),
              offsets: r.offsets,
              audience: r.audience,
              label: r.label,
              doneAt: r.doneAt ? new Date(r.doneAt) : null,
              doneById: r.doneAt ? ctx.user.id : null,
            },
            update: {
              dueAt: new Date(r.dueAt),
              offsets: r.offsets,
              audience: r.audience,
              label: r.label,
              doneAt: r.doneAt ? new Date(r.doneAt) : null,
              deletedAt: null,
              doneById: r.doneAt && !prev?.doneAt ? ctx.user.id : undefined,
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
            createdById: prev?.createdById ?? ctx.user.id,
            dueAt: new Date(r.dueAt),
            offsets: r.offsets,
            audience: r.audience,
            label: r.label,
            recipients: r.recipients,
            doneAt: r.doneAt ? new Date(r.doneAt) : null,
          }
          await rebuildDeliveries(tx, forRebuild)
        }

        const toDelete = [...existingById.keys()].filter((id) => !incomingIds.has(id))
        if (toDelete.length) {
          await tx.reminder.updateMany({
            where: { id: { in: toDelete }, deletedAt: null },
            data: { deletedAt: new Date() },
          })
          await cancelPendingDeliveries(tx, toDelete, 'reminder removed')
        }
      })

      return { ok: true }
    }),
})
