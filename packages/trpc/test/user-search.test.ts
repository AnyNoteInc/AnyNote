import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({
  getUserFromRequest: vi.fn(),
  withVerificationResendContext: vi.fn(),
  auth: {},
}))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'
import { userRouter } from '../src/routers/user'
import { createCallerFactory } from '../src/trpc'

const caller = createCallerFactory(userRouter)

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: 'u1', email: 'u1@x.y', emailVerified: true },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

describe('user.search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns [] for queries shorter than 3 chars without querying', async () => {
    const prisma = { user: { findMany: vi.fn() } } as never
    const res = await caller(ctx(prisma)).search({ query: 'ab' })
    expect(res).toEqual([])
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('prefix-matches email/name, caps at 8, excludes self', async () => {
    const prisma = {
      user: {
        findMany: vi.fn(async () => [
          { id: 'u2', firstName: 'Bo', lastName: 'B', email: 'bob@x.y', image: null },
        ]),
      },
    } as never
    const res = await caller(ctx(prisma)).search({ query: 'bob' })
    expect(res).toHaveLength(1)
    const arg = prisma.user.findMany.mock.calls[0][0]
    expect(arg.take).toBe(8)
    expect(arg.where.id).toEqual({ not: 'u1' })
  })
})
