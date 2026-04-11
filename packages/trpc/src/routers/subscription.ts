import { router, protectedProcedure } from "../trpc.js"
import { getActivePlanForUser } from "../helpers/plan.js"

export const subscriptionRouter = router({
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    return getActivePlanForUser(ctx.prisma, ctx.user.id)
  }),

  listHistory: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.subscription.findMany({
      where: { userId: ctx.user.id },
      include: { plan: true },
      orderBy: { startedAt: "desc" },
    })
  }),
})
