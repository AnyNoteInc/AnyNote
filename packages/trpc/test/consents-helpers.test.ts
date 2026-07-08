import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import { ConsentDocumentType, ConsentSource, type PrismaClient } from '@repo/db'

import {
  extractIpAddress,
  extractUserAgent,
  getCurrentConsents,
  hasAllRequiredConsents,
  writeConsentBatch,
  writeMarketingToggle,
} from '../src/lib/consents'

const USER_ID = '00000000-0000-4000-8000-000000000001'

vi.mock('../src/lib/document-versions', () => {
  const versionMap: Record<string, string> = {
    USER_AGREEMENT: 'sha256:ua',
    PRIVACY_POLICY: 'sha256:pp',
    PII_PROCESSING: 'sha256:pii',
    MARKETING: 'sha256:mk',
    PUBLIC_OFFER: 'sha256:po',
  }
  return {
    getDocumentVersionForType: (t: string) => versionMap[t],
    setDocumentVersionResolver: vi.fn(),
  }
})

describe('extractIpAddress', () => {
  it('returns first segment of x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' })
    expect(extractIpAddress(h)).toBe('203.0.113.5')
  })

  it('falls back to x-real-ip', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.7' })
    expect(extractIpAddress(h)).toBe('198.51.100.7')
  })

  it('returns null when no header is present', () => {
    expect(extractIpAddress(new Headers())).toBeNull()
  })
})

describe('extractUserAgent', () => {
  it('returns user-agent header truncated to 1024', () => {
    const long = 'a'.repeat(2000)
    const h = new Headers({ 'user-agent': long })
    expect(extractUserAgent(h)?.length).toBe(1024)
  })

  it('returns null when missing', () => {
    expect(extractUserAgent(new Headers())).toBeNull()
  })
})

describe('hasAllRequiredConsents', () => {
  const required = [
    ConsentDocumentType.USER_AGREEMENT,
    ConsentDocumentType.PRIVACY_POLICY,
    ConsentDocumentType.PII_PROCESSING,
    ConsentDocumentType.PUBLIC_OFFER,
  ]

  it('returns true when all 4 required types are granted', () => {
    const consents = required.map((t) => ({
      documentType: t,
      granted: true,
      grantedAt: new Date(),
      documentVersion: 'sha256:x',
    }))
    expect(hasAllRequiredConsents(consents)).toBe(true)
  })

  it('returns false when any required type is missing', () => {
    const consents = required.slice(0, 3).map((t) => ({
      documentType: t,
      granted: true,
      grantedAt: new Date(),
      documentVersion: 'sha256:x',
    }))
    expect(hasAllRequiredConsents(consents)).toBe(false)
  })

  it('returns false when any required type is denied', () => {
    const consents = required.map((t, i) => ({
      documentType: t,
      granted: i !== 1,
      grantedAt: new Date(),
      documentVersion: 'sha256:x',
    }))
    expect(hasAllRequiredConsents(consents)).toBe(false)
  })
})

describe('getCurrentConsents', () => {
  it('returns the most recent row per documentType', async () => {
    const rows = [
      {
        documentType: 'MARKETING',
        granted: false,
        createdAt: new Date('2026-05-10'),
        documentVersion: 'sha256:mk',
      },
      {
        documentType: 'MARKETING',
        granted: true,
        createdAt: new Date('2026-05-09'),
        documentVersion: 'sha256:mk',
      },
      {
        documentType: 'USER_AGREEMENT',
        granted: true,
        createdAt: new Date('2026-05-09'),
        documentVersion: 'sha256:ua',
      },
    ]
    const prisma = {
      userConsent: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    } as unknown as PrismaClient

    const result = await getCurrentConsents(prisma, USER_ID)

    const marketing = result.find((c) => c.documentType === 'MARKETING')
    expect(marketing?.granted).toBe(false)
    expect(marketing?.grantedAt).toEqual(new Date('2026-05-10'))
  })
})

describe('writeConsentBatch', () => {
  it('inserts 5 rows when no consents exist yet', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 5 })
    const findMany = vi.fn().mockResolvedValue([])
    const prisma = { userConsent: { createMany, findMany } } as unknown as PrismaClient

    await writeConsentBatch(prisma, {
      userId: USER_ID,
      marketing: true,
      source: ConsentSource.SIGN_UP,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    })

    expect(createMany).toHaveBeenCalledOnce()
    const arg = createMany.mock.calls[0][0]
    expect(arg.data).toHaveLength(5)
    expect(
      arg.data.find((d: { documentType: string }) => d.documentType === 'MARKETING').granted,
    ).toBe(true)
  })

  it('is idempotent: does nothing when current state already matches', async () => {
    const required = [
      'USER_AGREEMENT',
      'PRIVACY_POLICY',
      'PII_PROCESSING',
      'PUBLIC_OFFER',
      'MARKETING',
    ] as const
    const findMany = vi.fn().mockResolvedValue(
      required.map((t) => ({
        documentType: t,
        granted: true,
        createdAt: new Date(),
        documentVersion: 'sha256:x',
      })),
    )
    const createMany = vi.fn()
    const prisma = { userConsent: { createMany, findMany } } as unknown as PrismaClient

    await writeConsentBatch(prisma, {
      userId: USER_ID,
      marketing: true,
      source: ConsentSource.ONBOARDING,
      ipAddress: null,
      userAgent: null,
    })

    expect(createMany).not.toHaveBeenCalled()
  })
})

describe('writeMarketingToggle', () => {
  it('writes a new MARKETING row', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    const create = vi.fn().mockResolvedValue({})
    const prisma = { userConsent: { findFirst, create } } as unknown as PrismaClient

    await writeMarketingToggle(prisma, {
      userId: USER_ID,
      granted: true,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    })

    expect(create).toHaveBeenCalledOnce()
    const data = create.mock.calls[0][0].data
    expect(data.documentType).toBe('MARKETING')
    expect(data.granted).toBe(true)
    expect(data.source).toBe('SETTINGS')
  })

  it('dedupes: does not create when last MARKETING already matches', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValue({ granted: true, documentType: 'MARKETING', createdAt: new Date() })
    const create = vi.fn()
    const prisma = { userConsent: { findFirst, create } } as unknown as PrismaClient

    await writeMarketingToggle(prisma, {
      userId: USER_ID,
      granted: true,
      ipAddress: null,
      userAgent: null,
    })

    expect(create).not.toHaveBeenCalled()
  })
})
