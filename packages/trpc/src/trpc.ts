import { initTRPC, TRPCError } from '@trpc/server'
import * as Sentry from '@sentry/nextjs'

import { prisma } from '@repo/db'
import { getUserFromRequest } from '@repo/auth'
import type { CreatePaymentInput, Payment } from '@repo/yookassa'

type YookassaClientLike = {
  createPayment(input: CreatePaymentInput, idempotencyKey: string): Promise<Payment>
  getPayment(paymentId: string): Promise<Payment>
}

/** apps/web injects the real runner; tests/RSC default to a no-op. */
export type JobRunnerPort = { kick(jobId: string, kind: 'import' | 'export' | 'meeting'): void }

const NOOP_JOBS: JobRunnerPort = { kick: () => {} }

type CreateContextOptions = {
  req: Request
  resHeaders: Headers
  yookassa: YookassaClientLike
  returnUrlBase: string
  jobs?: JobRunnerPort
}

export const createContext = async ({
  req,
  resHeaders,
  yookassa,
  returnUrlBase,
  jobs,
}: CreateContextOptions) => {
  const user = await getUserFromRequest(req, resHeaders)
  // Tag every Sentry event raised during this call with who/where. Safe no-op
  // when the SDK isn't initialized (e.g. RSC server-caller without a DSN).
  if (user) {
    Sentry.setUser({ id: user.id })
  }
  return {
    prisma,
    user,
    headers: req.headers,
    resHeaders,
    yookassa,
    returnUrlBase,
    jobs: jobs ?? NOOP_JOBS,
  }
}

export const createServerContext = async (
  headers: Headers,
  yookassa: YookassaClientLike,
  returnUrlBase: string,
  jobs?: JobRunnerPort,
) => {
  return createContext({
    req: new Request('http://rsc.internal', { headers }),
    resHeaders: new Headers(),
    yookassa,
    returnUrlBase,
    jobs,
  })
}

export type Context = Awaited<ReturnType<typeof createContext>>

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session required' })
  }
  return next({ ctx: { ...ctx, user: ctx.user } })
})
