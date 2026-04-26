import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import { getActivePlanForUser } from '../helpers/plan'

export const subscriptionRouter = router({
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    return getActivePlanForUser(ctx.prisma, ctx.user.id)
  }),

  listHistory: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.subscription.findMany({
      where: { userId: ctx.user.id },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    })
  }),

  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await ctx.prisma.subscription.findFirst({
      where: { userId: ctx.user.id, status: 'ACTIVE' },
      include: { plan: true },
    })
    if (!sub) throw new TRPCError({ code: 'NOT_FOUND', message: 'NO_ACTIVE_SUBSCRIPTION' })
    if (sub.plan.slug === 'personal') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'CANNOT_CANCEL_FREE_PLAN' })
    }
    return ctx.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    })
  }),

  resume: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await ctx.prisma.subscription.findFirst({
      where: { userId: ctx.user.id, status: 'ACTIVE', cancelAtPeriodEnd: true },
    })
    if (!sub) throw new TRPCError({ code: 'NOT_FOUND', message: 'NO_CANCELED_SUBSCRIPTION' })
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
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      return order
    }),

  listOrders: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.order.findMany({
      where: { userId: ctx.user.id },
      include: { plan: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }),

  startCheckout: protectedProcedure
    .input(
      z.object({
        planSlug: z.enum(['pro', 'max']),
        period: z.enum(['MONTHLY', 'YEARLY']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.prisma.plan.findUnique({ where: { slug: input.planSlug } })
      if (!plan) throw new TRPCError({ code: 'NOT_FOUND', message: 'PLAN_NOT_FOUND' })

      const existing = await ctx.prisma.subscription.findFirst({
        where: { userId: ctx.user.id, status: 'ACTIVE', planId: plan.id },
      })
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'ALREADY_SUBSCRIBED' })

      const amountKopecks =
        input.period === 'MONTHLY' ? plan.priceMonthlyKopecks : plan.priceYearlyKopecks
      const idempotencyKey = randomUUID()

      const order = await ctx.prisma.order.create({
        data: {
          userId: ctx.user.id,
          planId: plan.id,
          billingPeriod: input.period,
          amountKopecks,
          currency: 'RUB',
          status: 'PENDING',
          isInitial: true,
          savedPaymentMethod: true,
          yookassaIdempotencyKey: idempotencyKey,
        },
      })

      const rub = (amountKopecks / 100).toFixed(2)
      const periodLabel = input.period === 'MONTHLY' ? 'Месяц' : 'Год'

      const payment = await ctx.yookassa.createPayment(
        {
          amount: { value: rub, currency: 'RUB' },
          capture: true,
          save_payment_method: true,
          confirmation: {
            type: 'redirect',
            return_url: `${ctx.returnUrlBase}/billing/return?orderId=${order.id}`,
          },
          description: `Подписка ${plan.name} (${periodLabel})`,
          metadata: {
            orderId: order.id,
            userId: ctx.user.id,
            planSlug: plan.slug,
            period: input.period,
          },
        },
        idempotencyKey,
      )

      await ctx.prisma.order.update({
        where: { id: order.id },
        data: { yookassaPaymentId: payment.id },
      })

      if (!payment.confirmation?.confirmation_url) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'NO_CONFIRMATION_URL' })
      }
      return { orderId: order.id, confirmationUrl: payment.confirmation.confirmation_url }
    }),
})
