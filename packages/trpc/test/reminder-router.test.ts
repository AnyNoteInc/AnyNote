import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})
vi.mock('@repo/notifications', () => ({
  rebuildDeliveries: vi.fn().mockResolvedValue(undefined),
  cancelPendingDeliveries: vi.fn().mockResolvedValue(undefined),
}))

import type { PrismaClient } from '@repo/db'

import { reminderRouter } from '../src/routers/reminder'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const REMINDER_ID = '00000000-0000-0000-0000-000000000004'

function ctx(prisma: PrismaClient, userId = USER_ID) {
  return {
    prisma,
    user: {
      id: userId,
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

function makeReminder(
  overrides: Partial<{
    id: string
    dueAt: string
    label: string | null
  }> = {},
) {
  return {
    id: overrides.id ?? REMINDER_ID,
    dueAt: overrides.dueAt ?? new Date(Date.now() + 86_400_000).toISOString(),
    offsets: [0],
    audience: 'ME' as const,
    label: overrides.label ?? 'Test reminder',
    recipients: [],
    doneAt: null,
  }
}

describe('reminder.syncForPage — upsert new reminder', () => {
  it('calls upsert with correct data and returns ok', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const deleteMany = vi.fn().mockResolvedValue({})
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const existing: unknown[] = []

    const txClient = {
      reminder: {
        findMany: vi.fn().mockResolvedValue(existing),
        upsert,
        updateMany,
      },
      reminderRecipient: { deleteMany, createMany: vi.fn().mockResolvedValue({}) },
      notificationDelivery: { updateMany: vi.fn().mockResolvedValue({}) },
    }

    const prisma = {
      page: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'EDITOR', workspaceId: WORKSPACE_ID, userId: USER_ID }),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(reminderRouter)(ctx(prisma))
    const result = await caller.syncForPage({
      pageId: PAGE_ID,
      reminders: [makeReminder()],
    })

    expect(result).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledOnce()
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ id: REMINDER_ID })
    expect(arg.create.pageId).toBe(PAGE_ID)
    expect(arg.create.workspaceId).toBe(WORKSPACE_ID)
    expect(arg.create.label).toBe('Test reminder')
    expect(arg.update.deletedAt).toBeNull()
  })
})

describe('reminder.syncForPage — soft-delete when missing from payload', () => {
  it('calls updateMany with deletedAt and cancelPendingDeliveries for removed reminders', async () => {
    const { cancelPendingDeliveries } = await import('@repo/notifications')
    vi.mocked(cancelPendingDeliveries).mockClear()

    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const deleteMany = vi.fn().mockResolvedValue({})

    const txClient = {
      reminder: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: REMINDER_ID,
            deletedAt: null,
            doneAt: null,
            dueAt: new Date(),
            offsets: [0],
            audience: 'ME',
            createdById: USER_ID,
          },
        ]),
        upsert: vi.fn().mockResolvedValue({}),
        updateMany,
      },
      reminderRecipient: { deleteMany, createMany: vi.fn().mockResolvedValue({}) },
      notificationDelivery: { updateMany: vi.fn().mockResolvedValue({}) },
    }

    const prisma = {
      page: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'EDITOR', workspaceId: WORKSPACE_ID, userId: USER_ID }),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(reminderRouter)(ctx(prisma))
    await caller.syncForPage({ pageId: PAGE_ID, reminders: [] })

    expect(updateMany).toHaveBeenCalledOnce()
    const arg = updateMany.mock.calls[0][0]
    expect(arg.where.id.in).toContain(REMINDER_ID)
    expect(arg.where.deletedAt).toBeNull()
    expect(arg.data.deletedAt).toBeInstanceOf(Date)
    expect(cancelPendingDeliveries).toHaveBeenCalledOnce()
    expect(vi.mocked(cancelPendingDeliveries).mock.calls[0][1]).toContain(REMINDER_ID)
  })
})

describe('reminder.syncForPage — undo restoration (soft-deleted UUID re-synced)', () => {
  it('calls upsert with deletedAt: null when a previously deleted reminder is re-synced', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const deleteMany = vi.fn().mockResolvedValue({})
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })

    const txClient = {
      reminder: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: REMINDER_ID,
            deletedAt: new Date(), // previously soft-deleted
            doneAt: null,
            dueAt: new Date(),
            offsets: [0],
            audience: 'ME',
            createdById: USER_ID,
          },
        ]),
        upsert,
        updateMany,
      },
      reminderRecipient: { deleteMany, createMany: vi.fn().mockResolvedValue({}) },
      notificationDelivery: { updateMany: vi.fn().mockResolvedValue({}) },
    }

    const prisma = {
      page: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'EDITOR', workspaceId: WORKSPACE_ID, userId: USER_ID }),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(reminderRouter)(ctx(prisma))
    await caller.syncForPage({
      pageId: PAGE_ID,
      reminders: [makeReminder()], // same REMINDER_ID re-synced
    })

    expect(upsert).toHaveBeenCalledOnce()
    const updateArg = upsert.mock.calls[0][0].update
    expect(updateArg.deletedAt).toBeNull()
    // The id is not in toDelete since it is present in incomingIds
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe('reminder.syncForPage — rejects VIEWER role', () => {
  it('throws FORBIDDEN when the caller has VIEWER role', async () => {
    const prisma = {
      page: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'VIEWER', workspaceId: WORKSPACE_ID, userId: USER_ID }),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaClient

    const caller = createCallerFactory(reminderRouter)(ctx(prisma))
    await expect(
      caller.syncForPage({ pageId: PAGE_ID, reminders: [makeReminder()] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Transaction should never have been entered
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('reminder.syncForPage — rejects LIST audience with non-member recipients', () => {
  it('throws BAD_REQUEST when a recipient is not a workspace member', async () => {
    const NON_MEMBER_ID = '00000000-0000-0000-0000-000000000099'

    const prisma = {
      page: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ role: 'EDITOR', workspaceId: WORKSPACE_ID, userId: USER_ID }),
        findMany: vi.fn().mockResolvedValue([]), // no members match the recipient
      },
      $transaction: vi.fn(),
    } as unknown as PrismaClient

    const caller = createCallerFactory(reminderRouter)(ctx(prisma))
    await expect(
      caller.syncForPage({
        pageId: PAGE_ID,
        reminders: [
          {
            id: REMINDER_ID,
            dueAt: new Date(Date.now() + 86_400_000).toISOString(),
            offsets: [0],
            audience: 'LIST',
            label: 'X',
            recipients: [NON_MEMBER_ID],
            doneAt: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // Transaction should never have been entered
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
