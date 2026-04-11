import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"

const ThemeSchema = z.enum(["light", "dark", "system"])

const NotificationSettingsSchema = z.object({
  email: z.object({
    mentions: z.boolean(),
    comments: z.boolean(),
    weeklyDigest: z.boolean(),
  }),
})

export const userRouter = router({
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.userPreference.findUnique({
      where: { userId: ctx.user.id },
    })
  }),

  setTheme: protectedProcedure
    .input(z.object({ theme: ThemeSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.userPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, theme: input.theme },
        update: { theme: input.theme },
      })
    }),

  setNotificationSettings: protectedProcedure
    .input(NotificationSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.userPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, notificationSettings: input },
        update: { notificationSettings: input },
      })
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().min(1).max(255),
        lastName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: { firstName: input.firstName, lastName: input.lastName },
      })
    }),

  listSessions: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.session.findMany({
      where: { userId: ctx.user.id, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        token: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
    })
  }),

  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { id: input.sessionId },
      })
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      await ctx.prisma.session.delete({ where: { id: input.sessionId } })
      return { ok: true }
    }),
})
