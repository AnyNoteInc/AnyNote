import { TRPCError } from '@trpc/server'
import { DatabasePropertyType } from '@repo/db'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'
import { notifyDatabaseCellUpdate } from '../../helpers/database-notify'
import { rescheduleRemindersForDateCell } from '../../helpers/database-date-reminder'

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

      // Resolve the property once: its type drives the existence checks below
      // AND the Phase-5 notification fan-out (important-change classification).
      const prop = await ctx.prisma.databaseProperty.findUnique({
        where: { id: input.propertyId },
        select: { type: true, name: true },
      })

      const value = input.value
      if (value !== null && value !== undefined && value !== '') {
        if (prop?.type === DatabasePropertyType.FILE) {
          if (
            !Array.isArray(value) ||
            value.some((fileId) => typeof fileId !== 'string' || fileId.trim() === '')
          ) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ожидался список файлов' })
          }
          const uniqueIds = [...new Set(value)]
          if (uniqueIds.length !== value.length) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Файлы не должны повторяться',
            })
          }
          const files = await ctx.prisma.file.findMany({
            where: { id: { in: uniqueIds }, workspaceId: page.workspaceId },
            select: { id: true },
          })
          if (files.length !== uniqueIds.length) {
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

      const result = await mapDomain(() =>
        domainSvc.database.updateCellValue(ctx.user.id, input),
      )

      // Phase 5: notify after a successful write. PERSON → the new assignee is
      // the string value; anything else has no assignee. Side-effect only.
      if (prop) {
        const assigneeId =
          prop.type === DatabasePropertyType.PERSON && typeof value === 'string' && value !== ''
            ? value
            : null
        await notifyDatabaseCellUpdate(ctx.prisma, {
          actorId: ctx.user.id,
          workspaceId: page.workspaceId,
          pageId: input.pageId,
          rowId: input.rowId,
          propertyId: input.propertyId,
          propertyType: prop.type,
          propertyName: prop.name,
          assigneeId,
        })

        // Phase 5 (5.4): a DATE-cell change reschedules (or cancels) the
        // self-targeted reminders attached to it — only for owners who still
        // have row access (no content-bearing reminder leaks after access loss).
        if (prop.type === DatabasePropertyType.DATE) {
          await rescheduleRemindersForDateCell(
            ctx.prisma,
            {
              pageId: input.pageId,
              propertyId: input.propertyId,
              rowId: input.rowId,
              workspaceId: page.workspaceId,
              propertyName: prop.name,
            },
            (userId) => domainSvc.database.canUserViewRow(userId, input.pageId, input.rowId),
          )
        }
      }

      return result
    }),
})
