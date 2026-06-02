import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { columnRouter } from '../src/routers/kanban/column'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const COL_A = '00000000-0000-0000-0000-00000000000a'
const COL_B = '00000000-0000-0000-0000-00000000000b'

function ctx(prisma: PrismaClient, userId = USER_ID) {
  return {
    prisma,
    user: {
      id: userId,
      email: 't@e.com',
      firstName: 'T',
      lastName: 'U',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

const pageRow = { id: PAGE_ID, workspaceId: WORKSPACE_ID, createdById: USER_ID }

describe('kanban.column.create', () => {
  it('inserts at end position when no positioning args given', async () => {
    const create = vi.fn().mockResolvedValue({ id: COL_A })
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
      },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([{ position: 1024 }, { position: 2048 }]),
        create,
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await caller.create({ pageId: PAGE_ID, title: 'Review', kind: 'ACTIVE' })

    expect(create).toHaveBeenCalledWith({
      data: { pageId: PAGE_ID, title: 'Review', kind: 'ACTIVE', position: 2048 + 1024 },
    })
  })
})

describe('kanban.column.delete', () => {
  it('reassigns tasks to first remaining column then deletes', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 })
    const deleteCol = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { updateMany },
      kanbanColumn: { delete: deleteCol },
    }
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
      },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([
          { id: COL_A, position: 1024 },
          { id: COL_B, position: 2048 },
        ]),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await caller.delete({ pageId: PAGE_ID, id: COL_B })

    expect(updateMany).toHaveBeenCalledWith({
      where: { columnId: COL_B },
      data: { columnId: COL_A },
    })
    expect(deleteCol).toHaveBeenCalledWith({ where: { id: COL_B } })
  })

  it('rejects deleting the last column with BAD_REQUEST', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
      },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([{ id: COL_A, position: 1024 }]),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await expect(caller.delete({ pageId: PAGE_ID, id: COL_A })).rejects.toThrow(/последнюю/i)
  })

  it('requires edit-level access (FORBIDDEN for below-editor non-creator)', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue({ ...pageRow, createdById: 'someone-else' }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'VIEWER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await expect(caller.delete({ pageId: PAGE_ID, id: COL_A })).rejects.toThrow(/прав/i)
  })

  it('allows an EDITOR member (non-creator) to delete a column', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const deleteCol = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { updateMany },
      kanbanColumn: { delete: deleteCol },
    }
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue({ ...pageRow, createdById: 'someone-else' }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([
          { id: COL_A, position: 1024 },
          { id: COL_B, position: 2048 },
        ]),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await caller.delete({ pageId: PAGE_ID, id: COL_B })

    expect(deleteCol).toHaveBeenCalledWith({ where: { id: COL_B } })
  })
})
