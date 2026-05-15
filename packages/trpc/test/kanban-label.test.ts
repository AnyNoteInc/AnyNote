import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { labelRouter } from '../src/routers/kanban/label'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: {
      id: USER_ID,
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

describe('kanban.label.create', () => {
  it('rejects a color outside the palette', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(labelRouter)(ctx(prisma))
    await expect(
      caller.create({ pageId: PAGE_ID, name: 'urgent', color: '#000000' }),
    ).rejects.toThrow(/палитр/i)
  })

  it('accepts a color from the palette', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'l1' })
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      kanbanLabel: { findMany: vi.fn().mockResolvedValue([]), create },
    } as unknown as PrismaClient

    const caller = createCallerFactory(labelRouter)(ctx(prisma))
    await caller.create({ pageId: PAGE_ID, name: 'urgent', color: '#EF4444' })

    expect(create).toHaveBeenCalledOnce()
  })
})
