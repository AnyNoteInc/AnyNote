import { router, publicProcedure, createCallerFactory } from "./trpc"
import { userRouter } from "./routers/user"
import { workspaceRouter } from "./routers/workspace"
import { subscriptionRouter } from "./routers/subscription"
import { integrationRouter } from "./routers/integration"

export { createContext, createServerContext } from "./trpc"
export type { Context } from "./trpc"

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  user: userRouter,
  workspace: workspaceRouter,
  subscription: subscriptionRouter,
  integration: integrationRouter,
})

export const createCaller = createCallerFactory(appRouter)
export type AppRouter = typeof appRouter
