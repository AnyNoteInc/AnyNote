import { jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { HistoryPruneService } from './history-prune.service.js'
import type { PlanFeaturesService } from '../indexer/services/plan-features.service.js'

const NOW = new Date('2026-06-09T12:00:00.000Z')

function makeService(opts: {
  deleteMany: ReturnType<typeof jest.fn>
  findMany?: ReturnType<typeof jest.fn>
  getPageHistoryDays?: ReturnType<typeof jest.fn>
}) {
  const prisma = {
    workspace: { findMany: opts.findMany ?? jest.fn(async () => []) },
    pageRevision: { deleteMany: opts.deleteMany },
  } as unknown as PrismaClient
  const planFeatures = {
    getPageHistoryDays: opts.getPageHistoryDays ?? jest.fn(async () => 7),
  } as unknown as PlanFeaturesService
  return new HistoryPruneService(prisma, planFeatures)
}

describe('HistoryPruneService.pruneWorkspace', () => {
  it('deletes revisions older than the retention window (cutoff = now - days)', async () => {
    const deleteMany = jest.fn<PrismaClient['pageRevision']['deleteMany']>().mockResolvedValue({
      count: 3,
    } as never)
    const svc = makeService({ deleteMany })

    const deleted = await svc.pruneWorkspace('ws1', 30, NOW)

    expect(deleted).toBe(3)
    expect(deleteMany).toHaveBeenCalledTimes(1)
    const where = (deleteMany.mock.calls[0]![0] as { where: { page: { workspaceId: string }; createdAt: { lt: Date } } }).where
    expect(where.page.workspaceId).toBe('ws1')
    // 30 days before NOW
    expect(where.createdAt.lt).toEqual(new Date('2026-05-10T12:00:00.000Z'))
  })

  it('skips unlimited retention (null) — no delete, returns 0', async () => {
    const deleteMany = jest.fn<PrismaClient['pageRevision']['deleteMany']>()
    const svc = makeService({ deleteMany })

    const deleted = await svc.pruneWorkspace('ws1', null, NOW)

    expect(deleted).toBe(0)
    expect(deleteMany).not.toHaveBeenCalled()
  })
})

describe('HistoryPruneService.pruneAllWorkspaces', () => {
  it('prunes each workspace using its own pageHistoryDays and sums the deletions', async () => {
    const deleteMany = jest.fn<PrismaClient['pageRevision']['deleteMany']>()
      .mockResolvedValueOnce({ count: 2 } as never)
      .mockResolvedValueOnce({ count: 5 } as never)
    const findMany = jest.fn(async () => [{ id: 'ws1' }, { id: 'ws2' }, { id: 'ws3' }])
    // ws1 → 7 days, ws2 → 30 days, ws3 → unlimited (null, skipped)
    const getPageHistoryDays = jest
      .fn<(id: string) => Promise<number | null>>()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(null)
    const svc = makeService({ deleteMany, findMany, getPageHistoryDays })

    const total = await svc.pruneAllWorkspaces(NOW)

    expect(total).toBe(7) // 2 + 5 (+0 for the unlimited ws3)
    expect(deleteMany).toHaveBeenCalledTimes(2) // ws3 skipped
    expect(getPageHistoryDays).toHaveBeenCalledTimes(3)
  })
})
