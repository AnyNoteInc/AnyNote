import { jest, describe, it, expect, beforeEach } from '@jest/globals'

import type { PrismaClient } from '@repo/db'

import { StatsService } from './stats.service.js'

describe('StatsService', () => {
  const mockPrisma = {
    workspaceMember: { findMany: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
    page: {
      groupBy: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      count: jest.fn<(...a: unknown[]) => Promise<number>>(),
      findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    },
  } as unknown as PrismaClient

  let svc: StatsService

  beforeEach(() => {
    ;(mockPrisma.workspaceMember.findMany as jest.Mock).mockReset()
    ;(mockPrisma.page.groupBy as jest.Mock).mockReset()
    ;(mockPrisma.page.count as jest.Mock).mockReset()
    ;(mockPrisma.page.findUnique as jest.Mock).mockReset()
    svc = new StatsService(mockPrisma)
  })

  describe('getWorkspaceStats', () => {
    it('aggregates members, pagesByType, totalPages', async () => {
      ;(mockPrisma.workspaceMember.findMany as jest.Mock).mockResolvedValue([
        {
          userId: 'u1',
          role: 'OWNER',
          user: { id: 'u1', firstName: 'Ann', lastName: 'A', email: 'a@a' },
        },
      ] as never)
      ;(mockPrisma.page.groupBy as jest.Mock).mockResolvedValue([
        { type: 'TEXT', _count: { _all: 3 } },
        { type: 'EXCALIDRAW', _count: { _all: 1 } },
      ] as never)
      ;(mockPrisma.page.count as jest.Mock).mockResolvedValue(4 as never)

      const stats = await svc.getWorkspaceStats('w1')

      expect(stats).toEqual({
        members: [{ id: 'u1', firstName: 'Ann', lastName: 'A', email: 'a@a', role: 'OWNER' }],
        pagesByType: { TEXT: 3, EXCALIDRAW: 1 },
        totalPages: 4,
      })
    })
  })

  describe('getPageStats', () => {
    it('returns page metadata', async () => {
      const created = new Date('2026-01-01')
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'w1',
        type: 'TEXT',
        ownership: 'TEXT',
        createdAt: created,
        createdBy: { id: 'u1', firstName: 'Ann', lastName: 'A', email: 'a@a' },
      } as never)

      const stats = await svc.getPageStats('p1', 'w1')

      expect(stats.type).toBe('TEXT')
      expect(stats.createdAt).toEqual(created)
      expect(stats.createdBy?.id).toBe('u1')
    })

    it('throws when page in other workspace', async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        workspaceId: 'other',
      } as never)
      await expect(svc.getPageStats('p1', 'w1')).rejects.toThrow(/not found/i)
    })
  })
})
