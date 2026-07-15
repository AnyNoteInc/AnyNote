import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

// file.ts now imports @repo/domain (buildPageVisibilityWhere), which transitively
// pulls in real @repo/db enums (PageType, CollectionKind, PageTemplateScope, …).
// Use importOriginal so all real exports stay available; only `prisma` is stubbed.
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { fileRouter } from '../src/routers/file'
import { createCallerFactory } from '../src/trpc'

const createCaller = createCallerFactory(fileRouter)

const WORKSPACE_ID = '11111111-1111-4111-9111-111111111111'
const USER_ID = '22222222-2222-4222-9222-222222222222'
const OTHER_USER_ID = '33333333-3333-4333-9333-333333333333'
const FILE_ID = '44444444-4444-4444-9444-444444444444'
const OTHER_FILE_ID = '55555555-5555-4555-9555-555555555555'
const FOREIGN_FILE_ID = '66666666-6666-4666-9666-666666666666'
const DELETED_FILE_ID = '77777777-7777-4777-9777-777777777777'

function baseContext(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
  }
}

function memberOk() {
  return { workspaceId: WORKSPACE_ID, userId: USER_ID, role: 'EDITOR' }
}

describe('fileRouter.getWorkspaceMetadata', () => {
  it('returns safe ACTIVE metadata for coworker files with one workspace-scoped query', async () => {
    const findMany = vi.fn(async () => [
      { id: FILE_ID, name: 'owner.pdf', mimeType: 'application/pdf' },
      { id: OTHER_FILE_ID, name: 'coworker.png', mimeType: 'image/png' },
    ])
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    const result = await caller.getWorkspaceMetadata({
      workspaceId: WORKSPACE_ID,
      ids: [FILE_ID, OTHER_FILE_ID, FOREIGN_FILE_ID, DELETED_FILE_ID],
    })

    expect(result).toEqual([
      { id: FILE_ID, name: 'owner.pdf', mimeType: 'application/pdf' },
      { id: OTHER_FILE_ID, name: 'coworker.png', mimeType: 'image/png' },
    ])
    expect(findMany).toHaveBeenCalledOnce()
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: WORKSPACE_ID,
        status: 'ACTIVE',
        id: { in: [FILE_ID, OTHER_FILE_ID, FOREIGN_FILE_ID, DELETED_FILE_ID] },
      },
      select: { id: true, name: true, mimeType: true },
    })
  })

  it('rejects non-members without querying file metadata', async () => {
    const findMany = vi.fn()
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await expect(
      caller.getWorkspaceMetadata({ workspaceId: WORKSPACE_ID, ids: [FILE_ID] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('bounds the batch size', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany: vi.fn() },
    } as unknown as PrismaClient
    const ids = Array.from(
      { length: 101 },
      (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, '0')}`,
    )

    const caller = createCaller(baseContext(prisma))
    await expect(caller.getWorkspaceMetadata({ workspaceId: WORKSPACE_ID, ids })).rejects.toThrow()
  })
})

describe('fileRouter.listWorkspace', () => {
  it('returns paginated items with total and user relation', async () => {
    const createdAt = new Date('2026-04-22T10:00:00.000Z')
    const updatedAt = new Date('2026-04-22T10:01:00.000Z')
    const fileRow = {
      id: FILE_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      name: 'brief',
      ext: 'pdf',
      fileSize: BigInt(1024),
      mimeType: 'application/pdf',
      hash: 'h',
      path: 'p',
      status: 'ACTIVE',
      isPublic: false,
      downloadCount: 3,
      expiresAt: null,
      createdAt,
      updatedAt,
      user: {
        id: USER_ID,
        firstName: 'Ivan',
        lastName: 'Ivanov',
        email: 'ivan@example.com',
        image: null,
      },
    }

    const findMany = vi.fn(async () => [fileRow])
    const count = vi.fn(async () => 42)
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany, count },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    const result = await caller.listWorkspace({
      workspaceId: WORKSPACE_ID,
      page: 1,
      pageSize: 20,
    })

    expect(result).toEqual({
      items: [
        {
          ...fileRow,
          fileSize: '1024',
        },
      ],
      total: 42,
    })

    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
      },
      skip: 20,
      take: 20,
    })
    expect(count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' },
    })
  })

  it('applies case-insensitive name search and uploader filter', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany, count },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await caller.listWorkspace({
      workspaceId: WORKSPACE_ID,
      page: 0,
      pageSize: 20,
      search: '  Report  ',
      uploaderId: OTHER_USER_ID,
    })

    const expectedWhere = {
      workspaceId: WORKSPACE_ID,
      status: 'ACTIVE',
      name: { contains: 'Report', mode: 'insensitive' },
      userId: OTHER_USER_ID,
    }
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
    expect(count).toHaveBeenCalledWith({ where: expectedWhere })
  })

  it('ignores whitespace-only search', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany, count },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await caller.listWorkspace({
      workspaceId: WORKSPACE_ID,
      page: 0,
      pageSize: 20,
      search: '   ',
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' } }),
    )
  })

  it('forbids non-members', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany: vi.fn(), count: vi.fn() },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await expect(
      caller.listWorkspace({ workspaceId: WORKSPACE_ID, page: 0, pageSize: 20 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('fileRouter.listRecent', () => {
  function recentFile(id: string, createdAt: Date) {
    return {
      id,
      name: `file-${id.slice(0, 4)}`,
      mimeType: 'application/pdf',
      fileSize: BigInt(2048),
      createdAt,
    }
  }

  it('returns the latest N active files newest-first', async () => {
    const rows = [
      recentFile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', new Date('2026-04-25T10:05:00.000Z')),
      recentFile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', new Date('2026-04-25T10:04:00.000Z')),
      recentFile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', new Date('2026-04-25T10:03:00.000Z')),
      recentFile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', new Date('2026-04-25T10:02:00.000Z')),
      recentFile('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', new Date('2026-04-25T10:01:00.000Z')),
    ]
    const findMany = vi.fn(async () => rows)
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    const result = await caller.listRecent({ workspaceId: WORKSPACE_ID, limit: 5 })

    expect(result).toHaveLength(5)
    expect(result[0].fileSize).toBe('2048')
    expect(new Date(result[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result[1].createdAt).getTime(),
    )
    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
    })
  })

  it('defaults the limit to 5', async () => {
    const findMany = vi.fn(async () => [])
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await caller.listRecent({ workspaceId: WORKSPACE_ID })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })

  it('forbids non-members', async () => {
    const findMany = vi.fn()
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      file: { findMany },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await expect(caller.listRecent({ workspaceId: WORKSPACE_ID, limit: 5 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('fileRouter.workspaceUploaders', () => {
  it('lists unique uploaders for a workspace', async () => {
    const findMany = vi.fn(async () => [
      { id: USER_ID, firstName: 'Ivan', lastName: 'Ivanov', email: 'i@x', image: null },
      { id: OTHER_USER_ID, firstName: 'Petr', lastName: 'Petrov', email: 'p@x', image: '/a' },
    ])
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      user: { findMany },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    const result = await caller.workspaceUploaders({ workspaceId: WORKSPACE_ID })

    expect(findMany).toHaveBeenCalledWith({
      where: { files: { some: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' } } },
      select: { id: true, firstName: true, lastName: true, email: true, image: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    })
    expect(result).toHaveLength(2)
  })

  it('forbids non-members from listing uploaders', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      user: { findMany: vi.fn() },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await expect(caller.workspaceUploaders({ workspaceId: WORKSPACE_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
