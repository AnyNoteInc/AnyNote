import { afterEach, describe, expect, it, vi } from 'vitest'

import { DatabaseRepository } from '../../src/database/repositories/database.repository.ts'
import type { UnitOfWork } from '../../src/shared/unit-of-work.ts'

function makeHarness() {
  const client = {
    databaseSource: { findUnique: vi.fn(async () => null) },
    databaseView: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({
        id: 'view-1',
        type: 'TABLE',
        title: 'View',
        position: 0,
        settings: null,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
  }
  const uow = { client: vi.fn(() => client) } as unknown as UnitOfWork
  return { client, repository: new DatabaseRepository(uow) }
}

describe('DatabaseRepository view tombstones', () => {
  afterEach(() => vi.useRealTimers())

  it('filters archived views from every source schema projection and active list', async () => {
    const { client, repository } = makeHarness()

    await repository.findSourceByPageId('page-1')
    await repository.findSourceSchemaByPageId('page-1')
    await repository.listViews('source-1')

    expect(client.databaseSource.findUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        select: expect.objectContaining({
          views: expect.objectContaining({ where: { archivedAt: null } }),
        }),
      }),
    )
    expect(client.databaseSource.findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        select: expect.objectContaining({
          views: expect.objectContaining({ where: { archivedAt: null } }),
        }),
      }),
    )
    expect(client.databaseView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceId: 'source-1', archivedAt: null } }),
    )
  })

  it('finds and updates active views only, never resurrecting tombstones', async () => {
    const { client, repository } = makeHarness()

    await repository.findViewById('view-1')
    await repository.updateView('view-1', { title: 'Renamed' })

    expect(client.databaseView.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'view-1', archivedAt: null } }),
    )
    expect(client.databaseView.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'view-1', archivedAt: null } }),
    )
  })

  it('soft-archives an active view instead of deleting it', async () => {
    vi.useFakeTimers()
    const archivedAt = new Date('2026-07-16T09:00:00.000Z')
    vi.setSystemTime(archivedAt)
    const { client, repository } = makeHarness()

    await repository.deleteView('view-1')

    expect(client.databaseView.updateMany).toHaveBeenCalledWith({
      where: { id: 'view-1', archivedAt: null },
      data: { archivedAt },
    })
  })

  it('scans scoped page candidates without taking a deployment-wide table lock', async () => {
    const { client, repository } = makeHarness()

    await repository.hasEmbeddedViewReference('00000000-0000-7000-8000-000000000001', 'view-1')

    expect(client.$executeRaw).not.toHaveBeenCalled()
    expect(client.$queryRaw).toHaveBeenCalledOnce()
  })
})
