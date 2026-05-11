import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Prisma } from '@repo/db'

import { formatHumanOffset, rebuildDeliveries, cancelPendingDeliveries } from '../src/reminders.ts'

describe('formatHumanOffset', () => {
  it.each([
    [0, 'в момент истечения'],
    [60, '1 час'],
    [1440, '1 день'],
    [4320, '3 дня'],
    [10080, '1 неделя'],
    [43200, '1 месяц'],
  ])('formats %d minutes as %s', (minutes, expected) => {
    expect(formatHumanOffset(minutes)).toBe(expected)
  })

  it('falls back to "напоминание" for unknown offsets', () => {
    expect(formatHumanOffset(777)).toBe('напоминание')
  })
})

type Tx = Prisma.TransactionClient

function makeTx(overrides: Partial<Record<string, unknown>> = {}): Tx {
  const base = {
    workspaceMember: { findMany: vi.fn().mockResolvedValue([]) },
    reminderRecipient: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ email: 'a@b.c', emailVerified: true }) },
    notificationPreference: { findFirst: vi.fn().mockResolvedValue({ enabled: true }) },
    pushSubscription: { findMany: vi.fn().mockResolvedValue([]) },
    userConsent: { findFirst: vi.fn().mockResolvedValue(null) },
    notificationEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
    },
    notificationDelivery: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'del-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    notificationInApp: { create: vi.fn().mockResolvedValue({}) },
  }
  return { ...base, ...overrides } as unknown as Tx
}

describe('rebuildDeliveries', () => {
  const baseReminder = {
    id: '00000000-0000-0000-0000-000000000001',
    pageId: '22222222-2222-2222-2222-222222222222',
    workspaceId: '11111111-1111-1111-1111-111111111111',
    createdById: 'user-1',
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    offsets: [1440, 0],
    audience: 'ME' as const,
    label: 'Test',
    recipients: [],
    doneAt: null,
  }

  beforeEach(() => vi.clearAllMocks())

  it('creates one event + one delivery per (recipient, offset, channel) for ME audience', async () => {
    const tx = makeTx()
    await rebuildDeliveries(tx, baseReminder)
    expect((tx.notificationEvent as any).create).toHaveBeenCalledTimes(2)
  })

  it('skips offsets whose fireAt is already in the past', async () => {
    const tx = makeTx()
    const reminder = {
      ...baseReminder,
      dueAt: new Date(Date.now() + 30 * 60 * 1000),
      offsets: [1440, 0],
    }
    await rebuildDeliveries(tx, reminder)
    expect((tx.notificationEvent as any).create).toHaveBeenCalledTimes(1)
  })

  it('skips all deliveries when doneAt is set', async () => {
    const tx = makeTx()
    const reminder = { ...baseReminder, doneAt: new Date() }
    await rebuildDeliveries(tx, reminder)
    expect((tx.notificationEvent as any).create).not.toHaveBeenCalled()
  })

  it('resolves WORKSPACE audience to all current workspace members', async () => {
    const tx = makeTx({
      workspaceMember: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]),
      },
    })
    const reminder = { ...baseReminder, audience: 'WORKSPACE' as const, offsets: [0] }
    await rebuildDeliveries(tx, reminder)
    expect((tx.notificationEvent as any).create).toHaveBeenCalledTimes(2)
  })

  it('resolves LIST audience to provided recipients', async () => {
    const tx = makeTx()
    const reminder = {
      ...baseReminder,
      audience: 'LIST' as const,
      recipients: ['user-7', 'user-8'],
      offsets: [0],
    }
    await rebuildDeliveries(tx, reminder)
    expect((tx.notificationEvent as any).create).toHaveBeenCalledTimes(2)
  })
})

describe('cancelPendingDeliveries', () => {
  it('updates matching pending deliveries to SKIPPED', async () => {
    const tx = makeTx()
    await cancelPendingDeliveries(tx, ['rem-1', 'rem-2'], 'test reason')

    const updateMany = (tx.notificationDelivery as any).updateMany
    expect(updateMany).toHaveBeenCalledTimes(1)
    const call = updateMany.mock.calls[0][0]
    expect(call.where.status).toBe('PENDING')
    expect(call.data.status).toBe('SKIPPED')
    expect(call.data.lastError).toBe('test reason')
  })

  it('is a no-op for an empty reminder list', async () => {
    const tx = makeTx()
    await cancelPendingDeliveries(tx, [], 'test')
    expect((tx.notificationDelivery as any).updateMany).not.toHaveBeenCalled()
  })
})
