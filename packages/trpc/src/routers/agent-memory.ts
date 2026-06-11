import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../trpc'
import { assertRole, type WorkspaceRole } from '../helpers/membership'

const READERS: WorkspaceRole[] = ['OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER']

export const agentMemoryRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, READERS)
      return ctx.prisma.workspaceAgentMemory.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { scope: 'WORKSPACE' },
            { scope: 'USER', userId: ctx.user.id },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      })
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.workspaceAgentMemory.findUnique({
        where: { id: input.id },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      const isAuthor = row.userId === ctx.user.id
      if (!isAuthor) {
        // Author may always delete their own USER-scope rows.
        // Otherwise, require OWNER role on the workspace.
        await assertRole(ctx, row.workspaceId, ['OWNER'])
      }
      await ctx.prisma.workspaceAgentMemory.delete({ where: { id: input.id } })
      return { ok: true as const }
    }),
})
