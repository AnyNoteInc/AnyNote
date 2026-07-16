import { jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'
import type { StorageClient } from '@repo/storage'
import type { Pool } from 'pg'

import { CleanupService } from './cleanup.service.js'

describe('CleanupService.purgeOrphanedInterrupts', () => {
  it('returns the deleted count from the cleanup CTE', async () => {
    const query = jest.fn<Pool['query']>().mockResolvedValue({
      rows: [{ deleted: 7 }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never)
    const fakeDb = { query } as unknown as Pool

    const svc = new CleanupService(fakeDb, {} as PrismaClient, {} as StorageClient)
    const deleted = await svc.purgeOrphanedInterrupts()

    expect(deleted).toBe(7)
    expect(query).toHaveBeenCalledTimes(1)
    const sql = (query.mock.calls[0]![0] as string).toUpperCase()
    expect(sql).toContain('CHECKPOINTS')
    expect(sql).toContain('CHECKPOINT_WRITES')
    expect(sql).toContain('__INTERRUPT__')
    expect(sql).toContain('24 HOURS')
  })

  it('returns 0 when no rows match', async () => {
    const query = jest.fn<Pool['query']>().mockResolvedValue({
      rows: [{ deleted: 0 }],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    } as never)
    const fakeDb = { query } as unknown as Pool

    const svc = new CleanupService(fakeDb, {} as PrismaClient, {} as StorageClient)
    expect(await svc.purgeOrphanedInterrupts()).toBe(0)
  })
})

describe('CleanupService form upload cleanup', () => {
  const NOW = new Date('2026-07-16T12:00:00.000Z')

  function harness(
    options: {
      transactionFailureId?: string
      consumedRaceId?: string
      sharedPaths?: Set<string>
      deleteFailurePath?: string
    } = {},
  ) {
    const leases = [
      {
        id: 'lease-a',
        fileId: 'file-a',
        file: { path: 'forms/a/hash.bin', workspaceId: 'workspace-a' },
      },
      {
        id: 'lease-b',
        fileId: 'file-b',
        file: { path: 'forms/b/hash.bin', workspaceId: 'workspace-b' },
      },
    ]
    const leaseDeleteMany = jest.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id === options.transactionFailureId) throw new Error('tx failed')
      if (where.id === options.consumedRaceId) return { count: 0 }
      return { count: 1 }
    })
    const fileDeleteMany = jest.fn(async () => ({ count: 1 }))
    const fileCount = jest.fn(async ({ where }: { where: { path: string } }) =>
      options.sharedPaths?.has(where.path) ? 1 : 0,
    )
    const tx = {
      $queryRaw: jest.fn(async () => [{ id: 'workspace' }]),
      databaseFormUpload: { deleteMany: leaseDeleteMany },
      file: { deleteMany: fileDeleteMany, count: fileCount },
    }
    const prisma = {
      databaseFormUpload: {
        findMany: jest.fn(async () => leases),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    }
    const storage = {
      delete: jest.fn(async (path: string) => {
        if (path === options.deleteFailurePath) throw new Error('storage failed')
      }),
    }
    const agents = { query: jest.fn() } as unknown as Pool
    const service = new CleanupService(
      agents,
      prisma as unknown as PrismaClient,
      storage as unknown as StorageClient,
    )
    return { service, prisma, storage, tx, leaseDeleteMany, fileDeleteMany }
  }

  it('selects at most 500 expired unconsumed leases and deletes their rows transactionally', async () => {
    const { service, prisma, storage, tx, leaseDeleteMany, fileDeleteMany } = harness()

    await expect(service.purgeExpiredFormUploads(NOW)).resolves.toBe(2)

    expect(prisma.databaseFormUpload.findMany).toHaveBeenCalledWith({
      where: { consumedAt: null, expiresAt: { lt: NOW } },
      select: {
        id: true,
        fileId: true,
        file: { select: { path: true, workspaceId: true } },
      },
      orderBy: { expiresAt: 'asc' },
      take: 500,
    })
    expect(leaseDeleteMany).toHaveBeenCalledTimes(2)
    expect(fileDeleteMany).toHaveBeenCalledTimes(2)
    expect(storage.delete).toHaveBeenCalledTimes(2)
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4)
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      storage.delete.mock.invocationCallOrder[0]!,
    )
  })

  it('keeps a shared path and isolates transaction and object deletion failures', async () => {
    const { service, storage } = harness({ transactionFailureId: 'lease-a' })
    await expect(service.purgeExpiredFormUploads(NOW)).resolves.toBe(1)
    expect(storage.delete).toHaveBeenCalledWith('forms/b/hash.bin')

    const shared = harness({ sharedPaths: new Set(['forms/a/hash.bin']) })
    await expect(shared.service.purgeExpiredFormUploads(NOW)).resolves.toBe(2)
    expect(shared.storage.delete).not.toHaveBeenCalledWith('forms/a/hash.bin')
    expect(shared.storage.delete).toHaveBeenCalledWith('forms/b/hash.bin')

    const objectFailure = harness({ deleteFailurePath: 'forms/a/hash.bin' })
    await expect(objectFailure.service.purgeExpiredFormUploads(NOW)).resolves.toBe(1)
    expect(objectFailure.storage.delete).toHaveBeenCalledWith('forms/a/hash.bin')
    expect(objectFailure.storage.delete).toHaveBeenCalledWith('forms/b/hash.bin')
  })

  it('skips the file and object when the lease is consumed after the scan', async () => {
    const { service, storage, fileDeleteMany } = harness({ consumedRaceId: 'lease-a' })

    await expect(service.purgeExpiredFormUploads(NOW)).resolves.toBe(1)
    expect(fileDeleteMany).toHaveBeenCalledTimes(1)
    expect(storage.delete).not.toHaveBeenCalledWith('forms/a/hash.bin')
    expect(storage.delete).toHaveBeenCalledWith('forms/b/hash.bin')
  })

  it('runs agents and form cleanup independently', async () => {
    const { service } = harness()
    const agents = jest
      .spyOn(service, 'purgeOrphanedInterrupts')
      .mockRejectedValue(new Error('agents down'))
    const uploads = jest.spyOn(service, 'purgeExpiredFormUploads').mockResolvedValue(4)

    await expect(service.runHourly()).resolves.toBeUndefined()
    expect(agents).toHaveBeenCalledTimes(1)
    expect(uploads).toHaveBeenCalledTimes(1)
  })
})
