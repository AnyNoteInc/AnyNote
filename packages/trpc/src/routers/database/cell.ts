import { TRPCError } from '@trpc/server'
import { DatabasePropertyType } from '@repo/db'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const cellRouter = router({
  // The domain validates the raw value against the property type (and option set).
  // DATE values arrive via the `dateValue` field which the DTO coerces with
  // z.preprocess — the browser tRPC client has no superjson, so Date is sent as a
  // string and re-parsed here (Phase 2 gotcha).
  //
  // Cross-entity EXISTENCE checks (FILE → a File row, PAGE_LINK → a visible Page)
  // live HERE, not in the domain: they need the workspace/page-visibility tree the
  // tRPC ctx owns. The domain still owns the format/type validation. We resolve the
  // property type with one lightweight query and only run the check for a non-null
  // value of the relevant type.
  updateValue: protectedProcedure
    .input(domain.updateCellValueInput)
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageEditAccess(ctx, input.pageId)

      const value = input.value
      if (value !== null && value !== undefined && value !== '') {
        const prop = await ctx.prisma.databaseProperty.findUnique({
          where: { id: input.propertyId },
          select: { type: true },
        })

        if (prop?.type === DatabasePropertyType.FILE && typeof value === 'string') {
          const file = await ctx.prisma.file.findFirst({
            where: { id: value, workspaceId: page.workspaceId },
            select: { id: true },
          })
          if (!file) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Файл не найден' })
          }
        }

        if (prop?.type === DatabasePropertyType.PAGE_LINK && typeof value === 'string') {
          const linked = await ctx.prisma.page.findFirst({
            where: {
              id: value,
              workspaceId: page.workspaceId,
              deletedAt: null,
              AND: [domain.buildPageVisibilityWhere(ctx.user.id)],
            },
            select: { id: true },
          })
          if (!linked) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
          }
        }
      }

      return mapDomain(() => domainSvc.database.updateCellValue(ctx.user.id, input))
    }),
})
