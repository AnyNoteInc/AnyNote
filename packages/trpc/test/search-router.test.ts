import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

vi.mock('../src/services/page-search', () => ({
  searchPg: vi.fn(),
  searchQdrant: vi.fn(),
}))

import { Prisma, type PrismaClient } from '@repo/db'

import { searchRouter } from '../src/routers/search'
import { searchPg, searchQdrant } from '../src/services/page-search'
import { createCallerFactory } from '../src/trpc'

const USER = '99999999-9999-9999-9999-999999999999'
const WS = '11111111-1111-1111-1111-111111111111'
const PAGE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PAGE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

function memberPrisma(extras: Partial<Record<string, unknown>> = {}): PrismaClient {
  return {
    workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
    ...extras,
  } as unknown as PrismaClient
}

describe('search.search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns postgres results when non-empty', async () => {
    vi.mocked(searchPg).mockResolvedValue([
      { pageId: PAGE_A, title: 'PG hit', icon: null, blockNumber: 1, excerpt: 'hit' },
    ])
    vi.mocked(searchQdrant).mockResolvedValue([
      { pageId: PAGE_B, title: 'should be ignored', icon: null, blockNumber: 0, excerpt: 'x' },
    ])

    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    const out = await caller.search({ workspaceId: WS, query: 'query' })

    expect(out).toHaveLength(1)
    expect(out[0]?.pageId).toBe(PAGE_A)
  })

  it('does not call qdrant when postgres returns rows', async () => {
    vi.mocked(searchPg).mockResolvedValue([
      { pageId: PAGE_A, title: 'PG hit', icon: null, blockNumber: 0, excerpt: 'x' },
    ])
    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    await caller.search({ workspaceId: WS, query: 'query' })
    expect(searchQdrant).not.toHaveBeenCalled()
  })

  it('falls back to qdrant when postgres empty', async () => {
    vi.mocked(searchPg).mockResolvedValue([])
    vi.mocked(searchQdrant).mockResolvedValue([
      { pageId: PAGE_B, title: 'Qd hit', icon: null, blockNumber: 0, excerpt: 'x' },
    ])
    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    const out = await caller.search({ workspaceId: WS, query: 'query' })
    expect(out).toHaveLength(1)
    expect(out[0]?.pageId).toBe(PAGE_B)
  })

  it('rejects non-members', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    await expect(caller.search({ workspaceId: WS, query: 'query' })).rejects.toThrow(/участник/)
  })

  it('propagates postgres failure as a real error', async () => {
    vi.mocked(searchPg).mockRejectedValue(new Error('DB down'))
    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    await expect(caller.search({ workspaceId: WS, query: 'query' })).rejects.toThrow('DB down')
  })

  it('returns [] when qdrant fails after postgres is empty', async () => {
    vi.mocked(searchPg).mockResolvedValue([])
    vi.mocked(searchQdrant).mockRejectedValue(new Error('agents down'))
    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    const out = await caller.search({ workspaceId: WS, query: 'query' })
    expect(out).toEqual([])
  })
})

describe('search.history', () => {
  beforeEach(() => vi.clearAllMocks())

  it('history.list returns favorited flag for live pages only', async () => {
    const prisma = memberPrisma({
      searchHistory: {
        findMany: vi.fn(async () => [
          {
            pageId: PAGE_A,
            page: { id: PAGE_A, title: 'A', icon: 'doc' },
          },
        ]),
      },
      favoritePage: {
        findMany: vi.fn(async () => [{ pageId: PAGE_A }]),
      },
    })
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    const out = await caller.history.list({ workspaceId: WS })
    expect(out).toEqual([{ pageId: PAGE_A, title: 'A', icon: 'doc', isFavorite: true }])
  })

  it('history.add upserts and prunes', async () => {
    const upsert = vi.fn(async () => ({}))
    const exec = vi.fn(async () => 0)
    const prisma = memberPrisma({
      searchHistory: { upsert },
      $executeRaw: exec,
    })
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    await caller.history.add({ workspaceId: WS, pageId: PAGE_A })
    expect(upsert).toHaveBeenCalledOnce()
    expect(exec).toHaveBeenCalledOnce()
  })

  it('history.add swallows P2003 FK violation', async () => {
    const fkError = new Prisma.PrismaClientKnownRequestError('FK', {
      code: 'P2003',
      clientVersion: 'test',
    })
    const prisma = memberPrisma({
      searchHistory: {
        upsert: vi.fn(async () => {
          throw fkError
        }),
      },
      $executeRaw: vi.fn(),
    })
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    await expect(caller.history.add({ workspaceId: WS, pageId: PAGE_A })).resolves.toBeUndefined()
  })

  it('history.remove deletes the unique row', async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }))
    const prisma = memberPrisma({
      searchHistory: { deleteMany },
    })
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    await caller.history.remove({ workspaceId: WS, pageId: PAGE_A })
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: USER, workspaceId: WS, pageId: PAGE_A },
    })
  })
})
