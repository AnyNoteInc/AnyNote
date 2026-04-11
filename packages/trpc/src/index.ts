import { router, publicProcedure, createCallerFactory } from "./trpc.js"

export { createContext, createServerContext } from "./trpc.js"
export type { Context } from "./trpc.js"

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  users: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
  }),
})

export const createCaller = createCallerFactory(appRouter)

export type AppRouter = typeof appRouter
