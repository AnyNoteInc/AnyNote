import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageFtsService } from './page-fts.service.js'

describe('PageFtsService.search', () => {
  const queryRaw = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient
  let svc: PageFtsService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new PageFtsService(prisma)
  })

  it('maps rows and finds an excerpt for TEXT pages', async () => {
    queryRaw.mockResolvedValue([
      {
        id: 'p1',
        title: 'Roadmap',
        icon: null,
        type: 'TEXT',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'launch plan here' }] }] },
      },
    ])

    const out = await svc.search('w1', 'launch')

    expect(out).toEqual([
      { pageId: 'p1', title: 'Roadmap', icon: null, type: 'TEXT', blockNumber: 0, excerpt: 'launch plan here' },
    ])
  })

  it('returns empty for queries shorter than 2 chars without hitting the db', async () => {
    expect(await svc.search('w1', 'a')).toEqual([])
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('returns null blockNumber/excerpt for non-TEXT pages', async () => {
    queryRaw.mockResolvedValue([{ id: 'p2', title: 'Board', icon: '📋', type: 'KANBAN', content: null }])
    const out = await svc.search('w1', 'board')
    expect(out[0]).toEqual({ pageId: 'p2', title: 'Board', icon: '📋', type: 'KANBAN', blockNumber: null, excerpt: null })
  })
})
