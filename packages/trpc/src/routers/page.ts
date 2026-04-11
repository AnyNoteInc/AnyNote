import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"

export const pageRouter = router({
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.id,
          workspace: { members: { some: { userId: ctx.user.id } } },
        },
      })
      if (!page) throw new TRPCError({ code: "NOT_FOUND" })
      return page
    }),

  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          workspace: { members: { some: { userId: ctx.user.id } } },
          archived: false,
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          icon: true,
          parentType: true,
          parentId: true,
          createdAt: true,
        },
      })
    }),
})
