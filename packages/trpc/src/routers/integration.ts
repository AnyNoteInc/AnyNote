import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"

const ScopeSchema = z.enum(["USER", "WORKSPACE"])

export const integrationRouter = router({
  listProviders: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.integrationProvider.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: "asc" },
    })
  }),

  listMine: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.integration.findMany({
        where: {
          OR: [
            { scope: "USER", userId: ctx.user.id },
            ...(input.workspaceId ? [{ scope: "WORKSPACE" as const, workspaceId: input.workspaceId }] : []),
          ],
          status: { in: ["PENDING", "CONNECTED", "ERROR"] },
        },
        include: { provider: true },
      })
    }),

  connect: protectedProcedure
    .input(
      z.object({
        providerId: z.string().uuid(),
        scope: ScopeSchema,
        workspaceId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scope === "WORKSPACE" && !input.workspaceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "workspaceId required for WORKSPACE scope" })
      }
      if (input.scope === "WORKSPACE") {
        const member = await ctx.prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: input.workspaceId!, userId: ctx.user.id } },
        })
        if (!member) throw new TRPCError({ code: "FORBIDDEN" })
      }
      return ctx.prisma.integration.create({
        data: {
          providerId: input.providerId,
          scope: input.scope,
          userId: input.scope === "USER" ? ctx.user.id : null,
          workspaceId: input.scope === "WORKSPACE" ? input.workspaceId : null,
          status: "PENDING",
        },
      })
    }),

  disconnect: protectedProcedure
    .input(z.object({ integrationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const integration = await ctx.prisma.integration.findUnique({
        where: { id: input.integrationId },
      })
      if (!integration) throw new TRPCError({ code: "NOT_FOUND" })
      if (integration.scope === "USER" && integration.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" })
      }
      if (integration.scope === "WORKSPACE") {
        const member = await ctx.prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: integration.workspaceId!, userId: ctx.user.id } },
        })
        if (!member) throw new TRPCError({ code: "FORBIDDEN" })
      }
      return ctx.prisma.integration.update({
        where: { id: input.integrationId },
        data: { status: "DISCONNECTED" },
      })
    }),
})
