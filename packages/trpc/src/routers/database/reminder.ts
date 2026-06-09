import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { domain as domainSvc } from '../../domain'
import {
  resolveDatePropContext,
  readDateCellValue,
  rebuildConfigDeliveries,
  cancelConfigDeliveries,
} from '../../helpers/database-date-reminder'

// Phase 5 (5.4) — self-targeted database DATE-cell reminders.
//
// CRITICAL invariants:
//  - SELF-TARGET ONLY (Notion parity): the reminder is always for ctx.user.id;
//    the input has NO userId field, so a caller can never target another user.
//  - ACCESS-GATED: the caller must be able to VIEW the row (the cl4C row-access
//    resolver via `canUserViewRow`) — a user without row access cannot set or
//    receive a content-bearing reminder.
//  - The config (DatabaseDateReminder) is unique per (propertyId, rowId, userId)
//    and upserted here; the NotificationDelivery rows are (re)built from the DATE
//    cell value via the reusable `rebuildDatabaseDateReminderDeliveries` path.

const reminderTargetInput = z.object({
  pageId: z.string().uuid(),
  propertyId: z.string().uuid(),
  rowId: z.string().uuid(),
})

const setReminderInput = reminderTargetInput.extend({
  offsetMinutes: z.number().int().min(0).default(0),
  timezone: z.string().max(64).optional(),
})

export const reminderRouter = router({
  /**
   * Upsert the caller's self-targeted reminder for a DATE cell, then (re)build
   * its delivery rows from the current cell value. If the DATE cell is empty the
   * config is still stored but no deliveries are created.
   */
  setDatabaseDateReminder: protectedProcedure
    .input(setReminderInput)
    .mutation(async ({ ctx, input }) => {
      // Membership-level page access first (a non-member can't even resolve it).
      await assertPageAccess(ctx, input.pageId)

      // ROW access — the cl4C resolver. A user without row access must not be
      // able to set a content-bearing reminder.
      const canView = await domainSvc.database.canUserViewRow(
        ctx.user.id,
        input.pageId,
        input.rowId,
      )
      if (!canView) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа к этой строке' })
      }

      const dateCtx = await resolveDatePropContext(ctx.prisma, {
        pageId: input.pageId,
        propertyId: input.propertyId,
        rowId: input.rowId,
      })
      if (!dateCtx) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Свойство не является датой этой базы данных',
        })
      }

      // Upsert the config (self-target: userId = ctx.user.id, ALWAYS).
      const config = await ctx.prisma.databaseDateReminder.upsert({
        where: {
          propertyId_rowId_userId: {
            propertyId: input.propertyId,
            rowId: input.rowId,
            userId: ctx.user.id,
          },
        },
        create: {
          pageId: input.pageId,
          propertyId: input.propertyId,
          rowId: input.rowId,
          userId: ctx.user.id,
          offsetMinutes: input.offsetMinutes,
          timezone: input.timezone ?? null,
        },
        update: {
          offsetMinutes: input.offsetMinutes,
          timezone: input.timezone ?? null,
        },
        select: { id: true, offsetMinutes: true, timezone: true },
      })

      const dueAt = await readDateCellValue(ctx.prisma, input.rowId, input.propertyId)
      await rebuildConfigDeliveries(
        ctx.prisma,
        {
          reminderId: config.id,
          workspaceId: dateCtx.workspaceId,
          pageId: input.pageId,
          rowId: input.rowId,
          propertyId: input.propertyId,
          userId: ctx.user.id,
          offsetMinutes: config.offsetMinutes,
          label: dateCtx.propertyName,
        },
        dueAt,
      )

      return {
        id: config.id,
        offsetMinutes: config.offsetMinutes,
        timezone: config.timezone,
      }
    }),

  /** Delete the caller's own config + cancel its pending deliveries. */
  clearDatabaseDateReminder: protectedProcedure
    .input(reminderTargetInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      const config = await ctx.prisma.databaseDateReminder.findUnique({
        where: {
          propertyId_rowId_userId: {
            propertyId: input.propertyId,
            rowId: input.rowId,
            userId: ctx.user.id,
          },
        },
        select: { id: true },
      })
      if (!config) return { ok: true as const }
      await cancelConfigDeliveries(ctx.prisma, [config.id], 'database date reminder removed')
      await ctx.prisma.databaseDateReminder.delete({ where: { id: config.id } })
      return { ok: true as const }
    }),

  /** The caller's OWN reminder config for the cell (or null). */
  getDatabaseDateReminder: protectedProcedure
    .input(reminderTargetInput)
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      const config = await ctx.prisma.databaseDateReminder.findUnique({
        where: {
          propertyId_rowId_userId: {
            propertyId: input.propertyId,
            rowId: input.rowId,
            userId: ctx.user.id,
          },
        },
        select: { id: true, offsetMinutes: true, timezone: true },
      })
      return config
    }),
})
