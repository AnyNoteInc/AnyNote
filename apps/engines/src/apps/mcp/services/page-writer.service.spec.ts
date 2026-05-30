import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

// SP3 pattern: inject a fake Domain whose pages methods are jest.fn().
// The real domain.pages.* logic is covered by @repo/domain pages tests.
// Here we assert that PageWriter delegates correctly to domain.pages.create/reorder
// and that direct-Prisma methods (updatePage) continue to use this.prisma.
import { PageWriter } from './page-writer.service.js'

function makeFakeDomain(): Domain & {
  __mocks: { pagesCreate: ReturnType<typeof jest.fn>; pagesReorder: ReturnType<typeof jest.fn> }
} {
  const pagesCreate = jest.fn<(...a: unknown[]) => Promise<{ id: string }>>(
    async () => ({ id: 'new-1' }),
  )
  const pagesReorder = jest.fn<(...a: unknown[]) => Promise<{ id: string }>>(
    async () => ({ id: 'p1' }),
  )
  return {
    pages: { create: pagesCreate, reorder: pagesReorder } as unknown as Domain['pages'],
    favorites: {} as Domain['favorites'],
    notifications: {} as Domain['notifications'],
    reminders: {} as Domain['reminders'],
    workspace: {} as Domain['workspace'],
    kanban: {} as Domain['kanban'],
    billing: {} as Domain['billing'],
    __mocks: { pagesCreate, pagesReorder },
  }
}

function makeMockPrisma() {
  const txUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}))
  const outboxCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}))
  const pageFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1' }),
  )
  const txFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1' }),
  )
  const tx = {
    page: { findUnique: txFindUnique, update: txUpdate },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async (fn: unknown) => (fn as (t: typeof tx) => unknown)(tx),
  )
  return {
    page: { findUnique: pageFindUnique },
    $transaction,
    __mocks: { txUpdate, outboxCreate, pageFindUnique, txFindUnique, $transaction },
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof jest.fn>> }
}

describe('PageWriter', () => {
  let fakeDomain: ReturnType<typeof makeFakeDomain>
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let writer: PageWriter

  beforeEach(() => {
    jest.clearAllMocks()
    fakeDomain = makeFakeDomain()
    mockPrisma = makeMockPrisma()
    writer = new PageWriter(mockPrisma, fakeDomain)
  })

  it('createPage delegates to domain.pages.create and returns the id', async () => {
    const id = await writer.createPage({
      userId: 'u1',
      workspaceId: 'w1',
      parentId: null,
      title: 'Note',
      ownership: 'TEXT',
    })
    expect(id).toBe('new-1')
    expect(fakeDomain.__mocks.pagesCreate).toHaveBeenCalledTimes(1)
    const [userId, input] = fakeDomain.__mocks.pagesCreate.mock.calls[0] as [string, unknown]
    expect(userId).toBe('u1')
    expect(input).toMatchObject({ workspaceId: 'w1', parentId: null, title: 'Note', ownership: 'TEXT', type: 'TEXT' })
  })

  it('createPage passes contentYjs built from content to domain.pages.create', async () => {
    const content = { type: 'doc', content: [] }
    await writer.createPage({ userId: 'u1', workspaceId: 'w1', title: 'Note', content })
    const [, input] = fakeDomain.__mocks.pagesCreate.mock.calls[0] as [string, Record<string, unknown>]
    expect(input['contentYjs']).toBeInstanceOf(Uint8Array)
  })

  it('movePage delegates to domain.pages.reorder: calls reorder with correct pageId + parent/prev', async () => {
    await writer.movePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', newParentId: 'parent-2', prevPageId: null })
    expect(fakeDomain.__mocks.pagesReorder).toHaveBeenCalledTimes(1)
    const [userId, input] = fakeDomain.__mocks.pagesReorder.mock.calls[0] as [string, Record<string, unknown>]
    expect(userId).toBe('u1')
    expect(input).toMatchObject({ pageId: 'p1', newParentId: 'parent-2', newPrevPageId: null })
  })

  it('movePage throws when the page is not in the given workspace (engines cross-workspace guard)', async () => {
    mockPrisma.__mocks.pageFindUnique!.mockResolvedValue({ id: 'p1', workspaceId: 'OTHER' })
    await expect(
      writer.movePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', newParentId: null, prevPageId: null }),
    ).rejects.toThrow()
    // domain.pages.reorder must NOT be called if the guard throws
    expect(fakeDomain.__mocks.pagesReorder).not.toHaveBeenCalled()
  })

  it('updatePage stays direct-Prisma (does NOT call domain positioning)', async () => {
    await writer.updatePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', title: 'X' })
    // direct update via this.prisma.$transaction
    expect(mockPrisma.__mocks.txUpdate).toHaveBeenCalled()
    // domain.pages.create must NOT be called
    expect(fakeDomain.__mocks.pagesCreate).not.toHaveBeenCalled()
  })
})
