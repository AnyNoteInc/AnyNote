import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { attachmentRouter } from '../src/routers/kanban/attachment'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const OTHER_USER = '00000000-0000-0000-0000-0000000000be'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const TASK_ID = '00000000-0000-0000-0000-0000000000a1'
const FILE_ID = '00000000-0000-0000-0000-0000000000f0'

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

describe('kanban.attachment.attach', () => {
  it('upserts an attachment and writes ATTACHMENT_ADDED activity', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      taskAttachment: { upsert },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ pageId: PAGE_ID }),
      },
      file: {
        findFirst: vi.fn().mockResolvedValue({ id: FILE_ID }),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(attachmentRouter)(ctx(prisma))
    await caller.attach({ pageId: PAGE_ID, taskId: TASK_ID, fileId: FILE_ID })

    expect(upsert).toHaveBeenCalledWith({
      where: { taskId_fileId: { taskId: TASK_ID, fileId: FILE_ID } },
      create: { taskId: TASK_ID, fileId: FILE_ID, uploadedById: USER_ID },
      update: { deletedAt: null },
    })
    expect(activityCreate).toHaveBeenCalledWith({
      data: {
        taskId: TASK_ID,
        actorId: USER_ID,
        type: 'ATTACHMENT_ADDED',
        payload: { fileId: FILE_ID },
      },
    })
  })

  it('rejects when file is not in the page workspace', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: { findUniqueOrThrow: vi.fn().mockResolvedValue({ pageId: PAGE_ID }) },
      file: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(attachmentRouter)(ctx(prisma))
    await expect(
      caller.attach({ pageId: PAGE_ID, taskId: TASK_ID, fileId: FILE_ID }),
    ).rejects.toThrow(/воркспейс/i)
  })
})

describe('kanban.attachment.detach', () => {
  it('forbids non-uploader non-OWNER', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      taskAttachment: {
        findUnique: vi.fn().mockResolvedValue({
          uploadedById: OTHER_USER,
          task: { pageId: PAGE_ID },
        }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(attachmentRouter)(ctx(prisma))
    await expect(
      caller.detach({ pageId: PAGE_ID, taskId: TASK_ID, fileId: FILE_ID }),
    ).rejects.toThrow(/прав/i)
  })

  it('allows uploader to soft-delete (sets deletedAt) and writes activity', async () => {
    const update = vi.fn().mockResolvedValue({})
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      taskAttachment: { update },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      taskAttachment: {
        findUnique: vi.fn().mockResolvedValue({
          uploadedById: USER_ID,
          task: { pageId: PAGE_ID },
        }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(attachmentRouter)(ctx(prisma))
    await caller.detach({ pageId: PAGE_ID, taskId: TASK_ID, fileId: FILE_ID })

    expect(update).toHaveBeenCalledWith({
      where: { taskId_fileId: { taskId: TASK_ID, fileId: FILE_ID } },
      data: { deletedAt: expect.any(Date) },
    })
    expect(activityCreate).toHaveBeenCalledWith({
      data: {
        taskId: TASK_ID,
        actorId: USER_ID,
        type: 'ATTACHMENT_REMOVED',
        payload: { fileId: FILE_ID },
      },
    })
  })
})
