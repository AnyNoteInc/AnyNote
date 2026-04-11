import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"
import { getActivePlanForUser } from "../helpers/plan"

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
        return workspace
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
})
