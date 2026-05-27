import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/auth')>()
  return { ...actual, getUserFromRequest: vi.fn() }
})

vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'
import { apiKeyRouter } from '../src/routers/api-key'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '22222222-2222-2222-2222-222222222222'
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333'
const KEY_ID = '44444444-4444-4444-4444-444444444444'
const OTHER_KEY_ID = '55555555-5555-5555-5555-555555555555'

function baseContext(prisma: PrismaClient, userId = USER_ID) {
  return {
    prisma,
    user: { id: userId },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

describe('apiKey router', () => {
  describe('create', () => {
    it('returns fullKey once and persists hash', async () => {
      let capturedData: Record<string, unknown> | undefined
      const now = new Date()
      const createdRow = {
        id: KEY_ID,
        name: 'Cursor',
        keyPrefix: 'AAAAAAAA',
        keyLastFour: 'ZZZZ',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      }
      const prismaMock = {
        apiKey: {
          create: vi.fn().mockImplementation(({ data }) => {
            capturedData = data
            return Promise.resolve(createdRow)
          }),
        },
      } as unknown as PrismaClient

      const caller = createCallerFactory(apiKeyRouter)(baseContext(prismaMock))
      const result = await caller.create({ name: 'Cursor', ttl: '30d' })

      // fullKey in response, matches format
      expect(result.fullKey).toMatch(/^ank_[0-9A-Za-z]{24}$/)

      // keyPrefix 8 chars, keyLastFour 4 chars
      expect(result.keyPrefix.length).toBe(8)
      expect(result.keyLastFour.length).toBe(4)

      // expiresAt is not null
      expect(result.expiresAt).not.toBeNull()

      // DB row: keyHash is 64 hex chars (sha256), not equal to fullKey
      expect(capturedData!.keyHash).toMatch(/^[0-9a-f]{64}$/)
      expect(capturedData!.keyHash).not.toBe(result.fullKey)

      // no keyHash in the response
      expect('keyHash' in result).toBe(false)
    })

    it('sets expiresAt = null when ttl is never', async () => {
      let capturedData: Record<string, unknown> | undefined
      const now = new Date()
      const createdRow = {
        id: KEY_ID,
        name: 'Forever',
        keyPrefix: 'AAAAAAAA',
        keyLastFour: 'ZZZZ',
        createdAt: now,
        expiresAt: null,
      }
      const prismaMock = {
        apiKey: {
          create: vi.fn().mockImplementation(({ data }) => {
            capturedData = data
            return Promise.resolve(createdRow)
          }),
        },
      } as unknown as PrismaClient

      const caller = createCallerFactory(apiKeyRouter)(baseContext(prismaMock))
      const result = await caller.create({ name: 'Forever', ttl: 'never' })

      expect(capturedData!.expiresAt).toBeNull()
      expect(result.expiresAt).toBeNull()
    })

    it('rejects empty name with validation error', async () => {
      const prismaMock = {
        apiKey: { create: vi.fn() },
      } as unknown as PrismaClient

      const caller = createCallerFactory(apiKeyRouter)(baseContext(prismaMock))
      await expect(caller.create({ name: '', ttl: '30d' })).rejects.toThrow()
      expect(vi.mocked(prismaMock.apiKey.create)).not.toHaveBeenCalled()
    })
  })

  describe('list', () => {
    it('lists only own active keys, excludes revoked, no fullKey/keyHash in response', async () => {
      const now = new Date()
      const ownKey = {
        id: KEY_ID,
        name: 'MyKey',
        keyPrefix: 'AAAAAAAA',
        keyLastFour: 'ZZZZ',
        createdAt: now,
        expiresAt: null,
        lastUsedAt: null,
      }
      const prismaMock = {
        apiKey: {
          findMany: vi.fn().mockResolvedValue([ownKey]),
        },
      } as unknown as PrismaClient

      const caller = createCallerFactory(apiKeyRouter)(baseContext(prismaMock))
      const rows = await caller.list()

      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(KEY_ID)

      // must not expose secrets
      expect('fullKey' in rows[0]!).toBe(false)
      expect('keyHash' in rows[0]!).toBe(false)

      // confirm the query filters by userId and revokedAt: null
      const findMany = vi.mocked(prismaMock.apiKey.findMany)
      const callArgs = findMany.mock.calls[0]![0]!
      expect(callArgs.where).toMatchObject({ userId: USER_ID, revokedAt: null })
    })
  })

  describe('revoke', () => {
    it('soft-deletes the key (revokedAt is set)', async () => {
      const prismaMock = {
        apiKey: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as PrismaClient

      const caller = createCallerFactory(apiKeyRouter)(baseContext(prismaMock))
      const result = await caller.revoke({ id: KEY_ID })

      expect(result.ok).toBe(true)

      const updateMany = vi.mocked(prismaMock.apiKey.updateMany)
      const callArgs = updateMany.mock.calls[0]![0]!
      expect(callArgs.where).toMatchObject({ id: KEY_ID, userId: USER_ID, revokedAt: null })
      expect(callArgs.data.revokedAt).toBeInstanceOf(Date)
    })

    it("returns NOT_FOUND when revoking someone else's key", async () => {
      const prismaMock = {
        apiKey: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as PrismaClient

      // caller is OTHER_USER_ID trying to revoke KEY_ID (owned by USER_ID)
      const caller = createCallerFactory(apiKeyRouter)(baseContext(prismaMock, OTHER_USER_ID))
      await expect(caller.revoke({ id: KEY_ID })).rejects.toThrow(/NOT_FOUND/i)
    })

    it('returns NOT_FOUND when revoking twice (already revoked)', async () => {
      const prismaMock = {
        apiKey: {
          updateMany: vi
            .fn()
            .mockResolvedValueOnce({ count: 1 }) // first revoke succeeds
            .mockResolvedValueOnce({ count: 0 }), // second revoke: revokedAt is set, no matching row
        },
      } as unknown as PrismaClient

      const caller = createCallerFactory(apiKeyRouter)(baseContext(prismaMock))
      await caller.revoke({ id: OTHER_KEY_ID })
      await expect(caller.revoke({ id: OTHER_KEY_ID })).rejects.toThrow(/NOT_FOUND/i)
    })
  })
})
