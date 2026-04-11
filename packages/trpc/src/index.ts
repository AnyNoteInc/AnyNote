import { router, publicProcedure, createCallerFactory } from "./trpc.js"
import { userRouter } from "./routers/user.js"
import { workspaceRouter } from "./routers/workspace.js"
import { subscriptionRouter } from "./routers/subscription.js"
import { integrationRouter } from "./routers/integration.js"

export { createContext, createServerContext } from "./trpc.js"
export type { Context } from "./trpc.js"

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  user: userRouter,
  workspace: workspaceRouter,
  subscription: subscriptionRouter,
  integration: integrationRouter,
})

export const createCaller = createCallerFactory(appRouter)
export type AppRouter = typeof appRouter
