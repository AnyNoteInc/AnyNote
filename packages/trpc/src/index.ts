import { initTRPC } from "@trpc/server"

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

export const createCallerFactory = t.createCallerFactory

export const appRouter = t.router({
  health: t.procedure.query(() => ({ ok: true })),
  users: t.procedure.query(async ({ ctx }) => {
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
