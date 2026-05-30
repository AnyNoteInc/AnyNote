import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { PageWriter } from './page-writer.service.js'

// These tests cover direct-Prisma methods (setArchived). Domain is not called;
// pass a minimal stub to satisfy the constructor signature.
const fakeDomain = { pages: {} } as unknown as Domain

function makePrisma(page: unknown) {
  const update = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const outbox = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(page)
  const tx = { page: { findUnique, update }, outboxEvent: { create: outbox } }
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
  return { prisma, update }
}

describe('PageWriter.setArchived', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sets archived true', async () => {
    const { prisma, update } = makePrisma({ id: 'p1', workspaceId: 'w1' })
    await new PageWriter(prisma, fakeDomain).setArchived({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', archived: true })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { archived: true, updatedById: 'u1' },
    })
  })

  it('throws for a page in another workspace', async () => {
    const { prisma } = makePrisma({ id: 'p1', workspaceId: 'w-other' })
    await expect(
      new PageWriter(prisma, fakeDomain).setArchived({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', archived: false }),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })
})
