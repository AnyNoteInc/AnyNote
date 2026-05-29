import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { PageWriter } from './page-writer.service.js'

function makePrisma(page: unknown) {
  const update = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const outbox = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(page)
  const tx = { page: { findUnique, update }, outboxEvent: { create: outbox } }
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
  return { prisma, update, outbox }
}

describe('PageWriter.appendContent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('appends nodes to an existing TEXT doc and rewrites content', async () => {
    const current = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }
    const appended = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] }
    const { prisma, update } = makePrisma({ id: 'p1', workspaceId: 'w1', type: 'TEXT', content: current })
    const writer = new PageWriter(prisma)

    await writer.appendContent({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended })

    const data = (update.mock.calls[0]![0] as { data: { content: typeof current } }).data
    expect(data.content.content).toHaveLength(2)
  })

  it('throws PageNotFoundError for a page in another workspace', async () => {
    const { prisma } = makePrisma({ id: 'p1', workspaceId: 'w-other', type: 'TEXT', content: null })
    const writer = new PageWriter(prisma)
    await expect(
      writer.appendContent({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended: { type: 'doc', content: [] } }),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })
})
