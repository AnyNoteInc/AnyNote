import { initTRPC, TRPCError } from "@trpc/server"

import { prisma } from "@repo/db"
import { getUserFromRequest } from "@repo/auth"

type CreateContextOptions = {
  req: Request
  resHeaders: Headers
}

export const createContext = async ({ req, resHeaders }: CreateContextOptions) => {
  const user = await getUserFromRequest(req, resHeaders)
  return {
    prisma,
    user,
    headers: req.headers,
    resHeaders,
  }
}

export const createServerContext = async (headers: Headers) => {
  return createContext({
    req: new Request("http://rsc.internal", { headers }),
    resHeaders: new Headers(),
  })
}

export type Context = Awaited<ReturnType<typeof createContext>>

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session required" })
  }
  return next({ ctx: { ...ctx, user: ctx.user } })
})
