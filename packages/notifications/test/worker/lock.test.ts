import { describe, expect, it, vi } from 'vitest'

import { lockPendingDeliveries } from '../../src/worker/lock.ts'

describe('lockPendingDeliveries', () => {
  it('selects pending rows with FOR UPDATE SKIP LOCKED and updates lockedAt/lockedBy', async () => {
    const queryRaw = vi.fn(async () => [{ id: 'd1' }, { id: 'd2' }])
    const updateMany = vi.fn(async () => ({ count: 2 }))
    const tx = { $queryRaw: queryRaw, notificationDelivery: { updateMany } }
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never

    const ids = await lockPendingDeliveries(prisma, { workerId: 'w1', batchSize: 50 })
    expect(ids).toEqual(['d1', 'd2'])
    expect(queryRaw).toHaveBeenCalledOnce()
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d1', 'd2'] } },
      data: { lockedAt: expect.any(Date), lockedBy: 'w1' },
    })
  })

  it('returns empty array if nothing pending', async () => {
    const queryRaw = vi.fn(async () => [])
    const tx = { $queryRaw: queryRaw, notificationDelivery: { updateMany: vi.fn() } }
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never
    const ids = await lockPendingDeliveries(prisma, { workerId: 'w1', batchSize: 10 })
    expect(ids).toEqual([])
  })
})
