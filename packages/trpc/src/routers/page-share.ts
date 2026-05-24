import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../trpc'
import { assertCanManageShare } from '../helpers/page-access'

const RoleSchema = z.enum(['READER', 'COMMENTER', 'EDITOR'])
const AccessSchema = z.enum(['RESTRICTED', 'PUBLIC'])

function newShareId(): string {
  return randomBytes(32).toString('hex') // 64 hex chars, 256-bit entropy
}

const userSelect = { id: true, firstName: true, lastName: true, email: true, image: true } as const

const shareSelect = {
  id: true,
  shareId: true,
  access: true,
  linkRole: true,
  users: { select: { role: true, user: { select: userSelect } }, orderBy: { createdAt: 'asc' as const } },
} as const

export const pageShareRouter = router({
  // Read-only: never creates a row (so the toolbar manage-probe stays side-effect-free).
  get: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: shareSelect,
      })
      const owner = page.createdById
        ? await ctx.prisma.user.findUnique({ where: { id: page.createdById }, select: userSelect })
        : null
      return { share, owner, canManage: true }
    }),

  // Lazy create-or-return; called when the dialog opens (spec: lazy on dialog open).
  ensure: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const existing = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: shareSelect,
      })
      if (existing) return existing
      return ctx.prisma.pageShare.create({
        data: { pageId: input.pageId, shareId: newShareId(), createdById: ctx.user.id },
        select: shareSelect,
      })
    }),

  setAccess: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), access: AccessSchema, linkRole: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      return ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data: { access: input.access, linkRole: input.linkRole },
        select: { id: true, access: true, linkRole: true },
      })
    }),

  addUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid(), role: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      if (input.userId === page.createdById) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Автор уже является владельцем' })
      }
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: input.userId } },
      })
      if (member) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Пользователь уже имеет доступ к пространству',
        })
      }
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Доступ ещё не создан' })
      return ctx.prisma.pageShareUser.upsert({
        where: { pageShareId_userId: { pageShareId: share.id, userId: input.userId } },
        create: { pageShareId: share.id, userId: input.userId, role: input.role },
        update: { role: input.role },
        select: { role: true, user: { select: userSelect } },
      })
    }),

  updateUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid(), role: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Доступ ещё не создан' })
      return ctx.prisma.pageShareUser.update({
        where: { pageShareId_userId: { pageShareId: share.id, userId: input.userId } },
        data: { role: input.role },
        select: { role: true, user: { select: userSelect } },
      })
    }),

  removeUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) return { ok: true }
      await ctx.prisma.pageShareUser.deleteMany({
        where: { pageShareId: share.id, userId: input.userId },
      })
      return { ok: true }
    }),
})
