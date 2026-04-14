import { z } from "zod"
import { TRPCError } from "@trpc/server"
import type { PrismaClient } from "@repo/db"

import { router, protectedProcedure } from "../trpc"
import { getActivePlanForUser } from "../helpers/plan"
import { seedStartPage } from "../helpers/seed-start-page"

async function assertPaidPlan(ctx: { prisma: PrismaClient; user: { id: string } }) {
  const { plan } = await getActivePlanForUser(ctx.prisma, ctx.user.id)
  if (plan.slug === "free") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Это действие доступно на платных тарифах",
    })
  }
}

async function assertRole(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
  allowed: Array<"OWNER" | "ADMIN" | "EDITOR" | "COMMENTER" | "VIEWER" | "GUEST">,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || !allowed.includes(member.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Недостаточно прав" })
  }
  return member
}

export const workspaceRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(64),
        icon: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { plan } = await getActivePlanForUser(ctx.prisma, ctx.user.id)
      if (plan.maxWorkspaces !== null) {
        const owned = await ctx.prisma.workspaceMember.count({
          where: { userId: ctx.user.id, role: "OWNER" },
        })
        if (owned >= plan.maxWorkspaces) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `На тарифе ${plan.name} можно создать не больше ${plan.maxWorkspaces} пространств`,
          })
        }
      }

      return ctx.prisma.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: { name: input.name, icon: input.icon, createdById: ctx.user.id },
        })
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: ctx.user.id, role: "OWNER" },
        })
        await tx.userPreference.upsert({
          where: { userId: ctx.user.id },
          create: { userId: ctx.user.id, defaultWorkspaceId: workspace.id },
          update: { defaultWorkspaceId: workspace.id },
        })
        const { pageId } = await seedStartPage(tx, workspace.id, ctx.user.id)
        return { ...workspace, startPageId: pageId }
      })
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.workspace.findFirst({
        where: {
          id: input.id,
          members: { some: { userId: ctx.user.id } },
        },
      })
    }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.workspace.findMany({
      where: { members: { some: { userId: ctx.user.id } } },
      orderBy: { createdAt: "asc" },
    })
  }),

  getDefault: protectedProcedure.query(async ({ ctx }) => {
    const pref = await ctx.prisma.userPreference.findUnique({
      where: { userId: ctx.user.id },
      include: { defaultWorkspace: true },
    })
    return pref?.defaultWorkspace ?? null
  }),

  rename: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(64),
        icon: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.id, ["OWNER", "ADMIN"])
      return ctx.prisma.workspace.update({
        where: { id: input.id },
        data: { name: input.name, icon: input.icon },
      })
    }),

  listMembers: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, [
        "OWNER",
        "ADMIN",
        "EDITOR",
        "COMMENTER",
        "VIEWER",
        "GUEST",
      ])
      return ctx.prisma.workspaceMember.findMany({
        where: { workspaceId: input.workspaceId },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
        },
        orderBy: { createdAt: "asc" },
      })
    }),

  getMyRole: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: ctx.user.id } },
      })
      return member?.role ?? null
    }),

  inviteMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(["ADMIN", "EDITOR", "COMMENTER", "VIEWER"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ["OWNER"])
      await assertPaidPlan(ctx)

      const user = await ctx.prisma.user.findUnique({ where: { email: input.email } })
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Пользователь с таким email не зарегистрирован. Приглашения по ссылке будут позже.",
        })
      }

      return ctx.prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: user.id } },
        create: { workspaceId: input.workspaceId, userId: user.id, role: input.role },
        update: { role: input.role },
      })
    }),

  removeMember: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ["OWNER"])
      if (input.userId === ctx.user.id) {
        const owners = await ctx.prisma.workspaceMember.count({
          where: { workspaceId: input.workspaceId, role: "OWNER" },
        })
        if (owners <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Нельзя удалить единственного OWNER. Передайте роль другому или удалите пространство.",
          })
        }
      }
      await ctx.prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } },
      })
      return { ok: true }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.id, ["OWNER"])
      await ctx.prisma.workspace.delete({ where: { id: input.id } })
      return { ok: true }
    }),
})
