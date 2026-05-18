import { jest, describe, it, expect, beforeEach } from '@jest/globals'

import type { PrismaClient } from '@repo/db'

import { PageWriter } from './page-writer.service.js'

describe('PageWriter', () => {
  const mockPrisma = {
    $transaction: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    page: {
      create: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      update: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      findFirst: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    },
    outboxEvent: { create: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
  } as unknown as PrismaClient

  let writer: PageWriter

  beforeEach(() => {
    ;(mockPrisma.$transaction as jest.Mock).mockReset()
    ;(mockPrisma.page.create as jest.Mock).mockReset()
    ;(mockPrisma.page.update as jest.Mock).mockReset()
    ;(mockPrisma.page.findUnique as jest.Mock).mockReset()
    ;(mockPrisma.page.findFirst as jest.Mock).mockReset()
    ;(mockPrisma.outboxEvent.create as jest.Mock).mockReset()
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation((async (
      fn: (tx: PrismaClient) => Promise<unknown>,
    ) => fn(mockPrisma)) as never)
    writer = new PageWriter(mockPrisma)
  })

  describe('createPage', () => {
    it('creates page and enqueues outbox', async () => {
      ;(mockPrisma.page.create as jest.Mock).mockResolvedValue({ id: 'p1' } as never)

      const id = await writer.createPage({
        userId: 'u1',
        workspaceId: 'w1',
        title: 'Test',
        ownership: 'TEXT',
      })

      expect(id).toBe('p1')
      expect(mockPrisma.page.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'w1',
          title: 'Test',
          ownership: 'TEXT',
          createdById: 'u1',
          updatedById: 'u1',
        }),
        select: { id: true },
      })
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: 'p1',
          workspaceId: 'w1',
        }),
      })
    })

    it('allows createPage without parent', async () => {
      ;(mockPrisma.page.create as jest.Mock).mockResolvedValue({ id: 'p1' } as never)

      await expect(
        writer.createPage({
          userId: 'u1',
          workspaceId: 'w1',
          parentId: null,
          title: 'Test',
        }),
      ).resolves.toBe('p1')
      expect(mockPrisma.page.findUnique).not.toHaveBeenCalled()
    })

    it('rejects createPage with parent in other workspace', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        workspaceId: 'other',
        deletedAt: null,
      } as never)

      await expect(
        writer.createPage({
          userId: 'u1',
          workspaceId: 'w1',
          parentId: 'parent-1',
          title: 'Test',
        }),
      ).rejects.toThrow(/not found/i)
      expect(mockPrisma.page.create).not.toHaveBeenCalled()
    })

    it('rejects createPage with deleted parent', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        workspaceId: 'w1',
        deletedAt: new Date(),
      } as never)

      await expect(
        writer.createPage({
          userId: 'u1',
          workspaceId: 'w1',
          parentId: 'parent-1',
          title: 'Test',
        }),
      ).rejects.toThrow(/not found/i)
      expect(mockPrisma.page.create).not.toHaveBeenCalled()
    })

    it('persists content when supplied on create', async () => {
      const content = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
      }
      ;(mockPrisma.page.create as jest.Mock).mockResolvedValue({ id: 'p-content' } as never)

      const id = await writer.createPage({
        userId: 'u1',
        workspaceId: 'w1',
        parentId: null,
        title: 'With content',
        content,
      })

      expect(id).toBe('p-content')
      expect(mockPrisma.page.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ content }),
        select: { id: true },
      })
    })

    it('leaves content undefined when not supplied (backwards-compatible)', async () => {
      ;(mockPrisma.page.create as jest.Mock).mockResolvedValue({ id: 'p-no-content' } as never)

      await writer.createPage({
        userId: 'u1',
        workspaceId: 'w1',
        parentId: null,
        title: 'No content',
      })

      const callArg = (mockPrisma.page.create as jest.Mock).mock.calls[0][0] as {
        data: Record<string, unknown>
      }
      expect(callArg.data.content).toBeUndefined()
    })
  })

  describe('updatePage', () => {
    it('rejects when page belongs to another workspace', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'other',
      } as never)
      await expect(
        writer.updatePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', title: 'x' }),
      ).rejects.toThrow(/not found/i)
    })

    it('updates page and enqueues outbox', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'w1',
      } as never)
      ;(mockPrisma.page.update as jest.Mock).mockResolvedValue({ id: 'p1' } as never)

      await writer.updatePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', title: 'new' })

      expect(mockPrisma.page.update).toHaveBeenCalled()
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalled()
    })
  })

  describe('movePage', () => {
    it('rejects cross-workspace page', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'p1',
        workspaceId: 'other',
        prevPageId: null,
      } as never)

      await expect(
        writer.movePage({
          userId: 'u1',
          workspaceId: 'w1',
          pageId: 'p1',
          newParentId: null,
          prevPageId: null,
        }),
      ).rejects.toThrow(/not found/i)
      expect(mockPrisma.page.update).not.toHaveBeenCalled()
    })

    it('relinks when moving to new position', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'page-m',
        workspaceId: 'w1',
        prevPageId: 'page-a',
      } as never)
      // findFirst calls: (1) oldSuccessor, (2) newSuccessor
      ;(mockPrisma.page.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'page-old-succ' } as never)
        .mockResolvedValueOnce({ id: 'page-new-succ' } as never)
      ;(mockPrisma.page.update as jest.Mock).mockResolvedValue({} as never)

      await writer.movePage({
        userId: 'u1',
        workspaceId: 'w1',
        pageId: 'page-m',
        newParentId: null,
        prevPageId: 'page-b',
      })

      // 2 findFirst calls (old successor + new successor)
      expect(mockPrisma.page.findFirst).toHaveBeenCalledTimes(2)
      expect(mockPrisma.page.findFirst).toHaveBeenNthCalledWith(1, {
        where: { prevPageId: 'page-m' },
        select: { id: true },
      })
      expect(mockPrisma.page.findFirst).toHaveBeenNthCalledWith(2, {
        where: { prevPageId: 'page-b', id: { not: 'page-m' } },
        select: { id: true },
      })

      // 5 update calls in order:
      //   detach old successor, detach new successor, update moved page,
      //   re-link old successor, re-link new successor.
      expect(mockPrisma.page.update).toHaveBeenCalledTimes(5)
      expect(mockPrisma.page.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'page-old-succ' },
        data: { prevPageId: null },
      })
      expect(mockPrisma.page.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'page-new-succ' },
        data: { prevPageId: null },
      })
      expect(mockPrisma.page.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'page-m' },
        data: {
          parentId: null,
          prevPageId: 'page-b',
          updatedById: 'u1',
        },
      })
      expect(mockPrisma.page.update).toHaveBeenNthCalledWith(4, {
        where: { id: 'page-old-succ' },
        data: { prevPageId: 'page-a' },
      })
      expect(mockPrisma.page.update).toHaveBeenNthCalledWith(5, {
        where: { id: 'page-new-succ' },
        data: { prevPageId: 'page-m' },
      })

      expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'page.upserted',
          aggregateId: 'page-m',
          workspaceId: 'w1',
        }),
      })
    })
  })
})
