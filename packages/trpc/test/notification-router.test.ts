import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

const notifMocks = vi.hoisted(() => ({
  markRead: vi.fn(async () => ({ updated: 1 })),
  markAllRead: vi.fn(async () => ({ updated: 2 })),
  deleteAll: vi.fn(async () => ({ deleted: 3 })),
}))
vi.mock('../src/domain', () => ({
  domain: { notifications: { markRead: notifMocks.markRead, markAllRead: notifMocks.markAllRead, deleteAll: notifMocks.deleteAll } },
}))

import type { PrismaClient } from '@repo/db'

import { notificationRouter } from '../src/routers/notification'
import { createCallerFactory } from '../src/trpc'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: {
      id: 'u1',
      email: 'u@e.com',
      firstName: 'A',
      lastName: 'B',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

describe('notification.list', () => {
  it('returns items + nextCursor when results equal limit', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a',
        createdAt: new Date('2026-05-10T10:00:00Z'),
        readAt: null,
        event: {
          type: 'WORKSPACE_INVITE',
          payload: {},
          resourceUrl: '/x',
          createdAt: new Date(),
          category: 'COLLABORATION',
          actorId: null,
          workspaceId: null,
        },
      },
      {
        id: 'b',
        createdAt: new Date('2026-05-10T09:00:00Z'),
        readAt: new Date(),
        event: {
          type: 'NEW_LOGIN',
          payload: {},
          resourceUrl: null,
          createdAt: new Date(),
          category: 'SECURITY',
          actorId: null,
          workspaceId: null,
        },
      },
    ])
    const prisma = { notificationInApp: { findMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.list({ limit: 2 })
    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).not.toBeNull()
  })

  it('returns null nextCursor when results below limit', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'a',
        createdAt: new Date(),
        readAt: null,
        event: {
          type: 'WORKSPACE_INVITE',
          payload: {},
          resourceUrl: null,
          createdAt: new Date(),
          category: 'COLLABORATION',
          actorId: null,
          workspaceId: null,
        },
      },
    ])
    const prisma = { notificationInApp: { findMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.list({ limit: 5 })
    expect(result.nextCursor).toBeNull()
  })
})

describe('notification.unreadCount', () => {
  it('counts only the calling user rows where readAt is null', async () => {
    const count = vi.fn().mockResolvedValue(7)
    const prisma = { notificationInApp: { count } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.unreadCount()
    expect(result).toBe(7)
    expect(count).toHaveBeenCalledWith({ where: { userId: 'u1', readAt: null } })
  })
})

describe('notification.markRead', () => {
  it('delegates to domain.notifications.markRead and returns updated count', async () => {
    notifMocks.markRead.mockResolvedValue({ updated: 2 })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.markRead({
      ids: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
    })
    expect(result.updated).toBe(2)
    expect(notifMocks.markRead).toHaveBeenCalledWith('u1', {
      ids: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
    })
  })
})

describe('notification.markAllRead', () => {
  it('delegates to domain.notifications.markAllRead and returns updated count', async () => {
    notifMocks.markAllRead.mockResolvedValue({ updated: 5 })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.markAllRead()
    expect(result.updated).toBe(5)
    expect(notifMocks.markAllRead).toHaveBeenCalledWith('u1')
  })
})

describe('notification.deleteAll', () => {
  it('delegates to domain.notifications.deleteAll and returns deleted count', async () => {
    notifMocks.deleteAll.mockResolvedValue({ deleted: 4 })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.deleteAll()
    expect(result.deleted).toBe(4)
    expect(notifMocks.deleteAll).toHaveBeenCalledWith('u1')
  })
})

describe('notification.getPreferences', () => {
  it('returns full matrix with locked flags from EVENT_CATALOG', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ category: 'COLLABORATION', channel: 'EMAIL', enabled: false }])
    const prisma = { notificationPreference: { findMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.getPreferences()
    expect(result.SECURITY.IN_APP).toEqual({ enabled: true, locked: true })
    expect(result.COLLABORATION.EMAIL).toEqual({ enabled: false, locked: false })
    expect(result.COLLABORATION.IN_APP).toEqual({ enabled: true, locked: true })
  })
})

describe('notification.setPreference', () => {
  it('throws BAD_REQUEST when channel is locked for category', async () => {
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await expect(
      caller.setPreference({ category: 'SECURITY', channel: 'IN_APP', enabled: false }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('throws FORBIDDEN when MARKETING/EMAIL toggled on without consent', async () => {
    const findFirst = vi.fn().mockResolvedValue({ granted: false })
    const prisma = { userConsent: { findFirst } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await expect(
      caller.setPreference({ category: 'MARKETING', channel: 'EMAIL', enabled: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('upserts the preference row on success', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const prisma = {
      notificationPreference: { upsert },
      userConsent: { findFirst: vi.fn().mockResolvedValue({ granted: true }) },
    } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await caller.setPreference({ category: 'COLLABORATION', channel: 'EMAIL', enabled: false })
    expect(upsert).toHaveBeenCalledOnce()
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({
      userId_category_channel: { userId: 'u1', category: 'COLLABORATION', channel: 'EMAIL' },
    })
    expect(arg.update).toMatchObject({ enabled: false })
  })
})

describe('notification.listPushSubscriptions', () => {
  it('returns own subs only', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: 's1', endpoint: 'e', userAgent: 'ua', createdAt: new Date() }])
    const prisma = { pushSubscription: { findMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.listPushSubscriptions()
    expect(result).toHaveLength(1)
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'desc' },
    })
  })
})

describe('notification.registerPushSubscription', () => {
  it('upserts by endpoint and binds to current user', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 's1' })
    const prisma = { pushSubscription: { upsert } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.registerPushSubscription({
      endpoint: 'https://push/x',
      keys: { p256dh: 'p', auth: 'a' },
      userAgent: 'Chrome',
    })
    expect(result.id).toBe('s1')
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ endpoint: 'https://push/x' })
    expect(arg.create.userId).toBe('u1')
  })
})

describe('notification.revokePushSubscription', () => {
  it('deletes only own row', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1', userId: 'u1' })
    const deleteFn = vi.fn().mockResolvedValue({})
    const prisma = {
      pushSubscription: { findUnique, delete: deleteFn },
    } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await caller.revokePushSubscription({ id: '00000000-0000-0000-0000-000000000001' })
    expect(deleteFn).toHaveBeenCalledWith({
      where: { id: '00000000-0000-0000-0000-000000000001' },
    })
  })

  it('throws NOT_FOUND when sub belongs to another user', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1', userId: 'other-user' })
    const prisma = {
      pushSubscription: { findUnique, delete: vi.fn() },
    } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await expect(
      caller.revokePushSubscription({ id: '00000000-0000-0000-0000-000000000001' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
