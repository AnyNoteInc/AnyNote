import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { router, protectedProcedure } from "../trpc"
import { getActivePlanForUser } from "../helpers/plan"

export const subscriptionRouter = router({
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    return getActivePlanForUser(ctx.prisma, ctx.user.id)
  }),

  listHistory: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.subscription.findMany({
      where: { userId: ctx.user.id },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    })
  }),

  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await ctx.prisma.subscription.findFirst({
      where: { userId: ctx.user.id, status: "ACTIVE" },
      include: { plan: true },
    })
    if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "NO_ACTIVE_SUBSCRIPTION" })
    if (sub.plan.slug === "personal") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "CANNOT_CANCEL_FREE_PLAN" })
    }
    return ctx.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    })
  }),

  resume: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await ctx.prisma.subscription.findFirst({
      where: { userId: ctx.user.id, status: "ACTIVE", cancelAtPeriodEnd: true },
    })
    if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "NO_CANCELED_SUBSCRIPTION" })
    return ctx.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: false, cancelledAt: null },
    })
  }),

  getOrder: protectedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const order = await ctx.prisma.order.findUnique({
        where: { id: input.orderId },
        include: { plan: { select: { name: true, slug: true } } },
      })
      if (!order || order.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }
      return order
    }),

  listOrders: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.order.findMany({
      where: { userId: ctx.user.id },
      include: { plan: { select: { name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
  }),
})
