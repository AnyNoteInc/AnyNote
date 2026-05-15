import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'

export const boardRouter = router({
  getBoard: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)

      const [columns, types, priorities, labels, sprints, tasks, members] = await Promise.all([
        ctx.prisma.kanbanColumn.findMany({
          where: { pageId: page.id },
          orderBy: { position: 'asc' },
        }),
        ctx.prisma.kanbanType.findMany({
          where: { pageId: page.id },
          orderBy: { position: 'asc' },
        }),
        ctx.prisma.kanbanPriority.findMany({
          where: { pageId: page.id },
          orderBy: { position: 'asc' },
        }),
        ctx.prisma.kanbanLabel.findMany({
          where: { pageId: page.id },
          orderBy: { position: 'asc' },
        }),
        ctx.prisma.sprint.findMany({
          where: { pageId: page.id },
          orderBy: { position: 'asc' },
        }),
        ctx.prisma.task.findMany({
          where: { pageId: page.id, deletedAt: null, archived: false },
          include: {
            assignees: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true } },
              },
            },
            labels: { include: { label: true } },
          },
          orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
        }),
        ctx.prisma.workspaceMember.findMany({
          where: { workspaceId: page.workspaceId },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        }),
      ])

      return { columns, types, priorities, labels, sprints, tasks, members }
    }),
})
