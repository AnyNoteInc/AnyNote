import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})
vi.mock('../src/lib/document-versions', () => ({
  getDocumentVersionForType: () => 'sha256:test',
  setDocumentVersionResolver: vi.fn(),
}))

import { type PrismaClient } from '@repo/db'

import { consentRouter } from '../src/routers/consent'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'

function ctx(prisma: PrismaClient, headers: Headers = new Headers()) {
  return {
    prisma,
    user: { id: USER_ID },
    headers,
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

describe('consent.list', () => {
  it('returns 5 entries (one per type), with granted=false for missing ones', async () => {
    const prisma = {
      userConsent: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              documentType: 'USER_AGREEMENT',
              granted: true,
              createdAt: new Date('2026-05-10'),
              documentVersion: 'sha256:ua',
            },
          ]),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(consentRouter)(ctx(prisma))
    const list = await caller.list()

    expect(list).toHaveLength(5)
    const ua = list.find((l) => l.documentType === 'USER_AGREEMENT')
    expect(ua?.granted).toBe(true)
    const marketing = list.find((l) => l.documentType === 'MARKETING')
    expect(marketing?.granted).toBe(false)
    expect(marketing?.grantedAt).toBeNull()
    expect(marketing?.url).toBe('/terms/marketing-consent')
  })
})

describe('consent.acceptRequired', () => {
  it('writes 5 rows with source=ONBOARDING and the supplied marketing flag', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 5 })
    const prisma = {
      userConsent: {
        createMany,
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(consentRouter)(
      ctx(prisma, new Headers({ 'x-forwarded-for': '127.0.0.1', 'user-agent': 'jest' })),
    )
    await caller.acceptRequired({ marketing: false })

    expect(createMany).toHaveBeenCalledOnce()
    const data = createMany.mock.calls[0][0].data as Array<{ source: string; ipAddress: string }>
    expect(data.every((d) => d.source === 'ONBOARDING')).toBe(true)
    expect(data[0].ipAddress).toBe('127.0.0.1')
  })
})

describe('consent.setMarketing', () => {
  it('writes one row when toggled', async () => {
    const create = vi.fn().mockResolvedValue({})
    const prisma = {
      userConsent: {
        create,
        findFirst: vi
          .fn()
          .mockResolvedValue({ granted: false, documentType: 'MARKETING', createdAt: new Date() }),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(consentRouter)(ctx(prisma))
    await caller.setMarketing({ granted: true })

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0].data.granted).toBe(true)
  })
})
