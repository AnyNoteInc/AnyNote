import { describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  signUpEmail: vi.fn(),
}))

vi.mock('@repo/auth', () => ({
  auth: { api: { signUpEmail: authMocks.signUpEmail } },
  getUserFromRequest: vi.fn(),
}))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})
vi.mock('../src/lib/document-versions', () => ({
  getDocumentVersionForType: () => 'sha256:test',
  setDocumentVersionResolver: vi.fn(),
}))

import type { PrismaClient } from '@repo/db'

import { authRouter } from '../src/routers/auth'
import { createCallerFactory } from '../src/trpc'

function ctx(prisma: PrismaClient, headers: Headers = new Headers()) {
  return {
    prisma,
    user: null,
    headers,
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

describe('auth.signUp', () => {
  it('calls auth.api.signUpEmail and writes 5 consent rows', async () => {
    authMocks.signUpEmail.mockResolvedValue({ user: { id: 'user-1' } })
    const createMany = vi.fn().mockResolvedValue({ count: 5 })
    const prisma = {
      userConsent: { createMany, findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(authRouter)(
      ctx(prisma, new Headers({ 'x-forwarded-for': '1.2.3.4', 'user-agent': 'ua' })),
    )

    await caller.signUp({
      email: 'e@e.com',
      password: 'pass1234',
      firstName: 'Имя',
      lastName: 'Фамилия',
      marketing: true,
    })

    expect(authMocks.signUpEmail).toHaveBeenCalledOnce()
    const callArg = authMocks.signUpEmail.mock.calls[0][0]
    expect(callArg.body.email).toBe('e@e.com')
    expect(callArg.body.name).toBe('Фамилия Имя')

    expect(createMany).toHaveBeenCalledOnce()
    const data = createMany.mock.calls[0][0].data as Array<{ source: string; granted: boolean; documentType: string }>
    expect(data).toHaveLength(5)
    expect(data.every((d) => d.source === 'SIGN_UP')).toBe(true)
    expect(data.find((d) => d.documentType === 'MARKETING')?.granted).toBe(true)
  })

  it('does not write consents when better-auth signUp throws', async () => {
    authMocks.signUpEmail.mockRejectedValueOnce(new Error('captcha failed'))
    const createMany = vi.fn()
    const prisma = { userConsent: { createMany, findMany: vi.fn() } } as unknown as PrismaClient

    const caller = createCallerFactory(authRouter)(ctx(prisma))

    await expect(
      caller.signUp({ email: 'e@e.com', password: 'pass1234', firstName: 'A', lastName: 'B', marketing: false }),
    ).rejects.toThrow('captcha failed')

    expect(createMany).not.toHaveBeenCalled()
  })
})
