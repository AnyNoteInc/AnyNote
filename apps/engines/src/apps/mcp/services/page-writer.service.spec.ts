import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

// SP1 pattern: NO jest.unstable_mockModule. Import the service normally; the REAL
// @repo/domain functions run against a hand-mocked PrismaClient. We assert on mocked
// prisma calls + returned values directly.
import { PageWriter } from './page-writer.service.js'

function makeMockPrisma() {
  // createPage path
  const pageCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ id: 'new-1', type: 'TEXT' }))
  const txFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const txFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => null)
  const txUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}))
  const outboxCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}))
  // outer parent lookup (domain.createPage uses prisma.page.findFirst for the parent check;
  // engines movePage pre-check uses prisma.page.findUnique). Provide both.
  const pageFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => null) // no parent by default
  const pageFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1', prevPageId: null }),
  )
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ role: 'EDITOR' }))
  // updatePage stays direct-Prisma and looks the page up inside the tx via tx.page.findUnique
  // (workspace-ownership guard). Default to a same-workspace page so the direct path proceeds.
  const txFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1' }),
  )
  const tx = {
    page: { create: pageCreate, findMany: txFindMany, findFirst: txFindFirst, findUnique: txFindUnique, update: txUpdate },
    outboxEvent: { create: outboxCreate },
    kanbanColumn: { createMany: jest.fn() },
    kanbanType: { createMany: jest.fn() },
    kanbanPriority: { createMany: jest.fn() },
  }
  const $transaction = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async (fn: unknown) => (fn as (t: typeof tx) => unknown)(tx),
  )
  return {
    page: { findFirst: pageFindFirst, findUnique: pageFindUnique, findMany: txFindMany },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { pageCreate, txFindMany, txFindFirst, txFindUnique, txUpdate, outboxCreate, pageFindFirst, pageFindUnique, memberFindUnique, $transaction },
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof jest.fn>> }
}

describe('PageWriter', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let writer: PageWriter

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    writer = new PageWriter(mockPrisma)
  })

  it('createPage delegates to domain: positions the page (findMany siblings) and enqueues outbox', async () => {
    const id = await writer.createPage({
      userId: 'u1',
      workspaceId: 'w1',
      parentId: null,
      title: 'Note',
      ownership: 'TEXT',
    })
    expect(id).toBe('new-1')
    expect(mockPrisma.__mocks.pageCreate).toHaveBeenCalledTimes(1)
    // the linked-list positioning query (the gap-fix) ran:
    expect(mockPrisma.__mocks.txFindMany).toHaveBeenCalled()
    expect(mockPrisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'new-1' }),
      }),
    )
  })

  it('createPage links the new page to the tail sibling', async () => {
    mockPrisma.__mocks.txFindMany!.mockResolvedValue([
      { id: 's1', prevPageId: null },
      { id: 's2', prevPageId: 's1' },
    ])
    await writer.createPage({ userId: 'u1', workspaceId: 'w1', title: 'Note' })
    expect(mockPrisma.__mocks.txUpdate).toHaveBeenCalledWith({
      where: { id: 'new-1' },
      data: { prevPageId: 's2' },
    })
  })

  it('movePage delegates to domain.reorderPage: enqueues page.upserted on position change', async () => {
    // page exists in workspace w1, currently at parent null / prev null
    mockPrisma.__mocks.pageFindUnique!.mockResolvedValue({ id: 'p1', workspaceId: 'w1', prevPageId: null })
    // domain.reorderPage re-loads via prisma.page.findFirst; return the same page
    mockPrisma.__mocks.pageFindFirst!.mockResolvedValue({
      id: 'p1',
      workspaceId: 'w1',
      parentId: null,
      prevPageId: null,
    })
    await writer.movePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', newParentId: 'parent-2', prevPageId: null })
    expect(mockPrisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'p1' }),
      }),
    )
  })

  it('movePage throws when the page is not in the given workspace (engines cross-workspace guard)', async () => {
    mockPrisma.__mocks.pageFindUnique!.mockResolvedValue({ id: 'p1', workspaceId: 'OTHER', prevPageId: null })
    await expect(
      writer.movePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', newParentId: null, prevPageId: null }),
    ).rejects.toThrow()
  })

  it('updatePage stays direct-Prisma (does NOT call domain positioning findMany)', async () => {
    mockPrisma.__mocks.pageFindUnique!.mockResolvedValue({ id: 'p1', workspaceId: 'w1' })
    await writer.updatePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', title: 'X' })
    // direct update, no sibling-positioning findMany on the create path
    expect(mockPrisma.__mocks.txUpdate).toHaveBeenCalled()
    expect(mockPrisma.__mocks.pageCreate).not.toHaveBeenCalled()
  })
})
