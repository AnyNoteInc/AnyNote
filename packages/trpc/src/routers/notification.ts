import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { NotificationCategory, NotificationChannel } from '@repo/db'
import { EVENT_CATALOG } from '@repo/notifications'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

import { router, protectedProcedure } from '../trpc'

const cursorSchema = z
  .object({
    createdAt: z.union([z.date(), z.string()]).transform((v) => new Date(v)),
    id: z.string().uuid(),
  })
  .optional()

export const notificationRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        cursor: cursorSchema,
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.notificationInApp.findMany({
        where: {
          userId: ctx.user.id,
          ...(input.cursor
            ? {
                OR: [
                  { createdAt: { lt: input.cursor.createdAt } },
                  { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit,
        include: { event: true },
      })
      const last = items[items.length - 1]
      const nextCursor =
        items.length === input.limit && last ? { createdAt: last.createdAt, id: last.id } : null
      return { items, nextCursor }
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.notificationInApp.count({
      where: { userId: ctx.user.id, readAt: null },
    })
  }),

  markRead: protectedProcedure
    .input(domain.markReadInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.notifications.markRead(ctx.user.id, input))
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    return mapDomain(() => domainSvc.notifications.markAllRead(ctx.user.id))
  }),

  deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
    return mapDomain(() => domainSvc.notifications.deleteAll(ctx.user.id))
  }),

  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.notificationPreference.findMany({
      where: { userId: ctx.user.id },
    })
    const overrideMap = new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]))

    const categories: NotificationCategory[] = [
      NotificationCategory.SECURITY,
      NotificationCategory.COLLABORATION,
      NotificationCategory.MARKETING,
    ]
    const channels: NotificationChannel[] = [
      NotificationChannel.EMAIL,
      NotificationChannel.IN_APP,
      NotificationChannel.WEB_PUSH,
    ]

    type Cell = { enabled: boolean; locked: boolean }
    const result: Record<string, Record<string, Cell>> = {}
    for (const category of categories) {
      result[category] = {}
      const sample = Object.values(EVENT_CATALOG).find((d) => d.category === category)
      for (const channel of channels) {
        const inDefaults = sample?.defaultChannels.includes(channel) ?? false
        const isLocked = sample?.lockedChannels.includes(channel) ?? false
        const overrideKey = `${category}:${channel}`
        const override = overrideMap.get(overrideKey)
        let enabled: boolean
        if (isLocked) {
          enabled = true
        } else if (override === undefined) {
          enabled = inDefaults
        } else {
          enabled = override
        }
        result[category][channel] = { enabled, locked: isLocked }
      }
    }
    return result as Record<NotificationCategory, Record<NotificationChannel, Cell>>
  }),

  setPreference: protectedProcedure
    .input(
      z.object({
        category: z.nativeEnum(NotificationCategory),
        channel: z.nativeEnum(NotificationChannel),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sample = Object.values(EVENT_CATALOG).find((d) => d.category === input.category)
      if (!sample) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown category' })
      if (sample.lockedChannels.includes(input.channel)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Channel is locked for this category',
        })
      }
      if (
        input.category === NotificationCategory.MARKETING &&
        input.channel === NotificationChannel.EMAIL &&
        input.enabled
      ) {
        const consent = await ctx.prisma.userConsent.findFirst({
          where: { userId: ctx.user.id, documentType: 'MARKETING' },
          orderBy: { createdAt: 'desc' },
        })
        if (!consent?.granted) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'MARKETING consent required' })
        }
      }
      await ctx.prisma.notificationPreference.upsert({
        where: {
          userId_category_channel: {
            userId: ctx.user.id,
            category: input.category,
            channel: input.channel,
          },
        },
        create: {
          userId: ctx.user.id,
          category: input.category,
          channel: input.channel,
          enabled: input.enabled,
        },
        update: { enabled: input.enabled },
      })
      return { ok: true }
    }),

  listPushSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.pushSubscription.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
    })
  }),

  registerPushSubscription: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
        userAgent: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          userId: ctx.user.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent,
        },
        update: {
          userId: ctx.user.id,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent,
          lastSeenAt: new Date(),
        },
      })
    }),

  revokePushSubscription: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sub = await ctx.prisma.pushSubscription.findUnique({ where: { id: input.id } })
      if (!sub || sub.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Subscription not found' })
      }
      await ctx.prisma.pushSubscription.delete({ where: { id: input.id } })
      return { ok: true }
    }),
})
