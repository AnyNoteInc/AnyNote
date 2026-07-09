import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Prisma } from '@repo/db'

import {
  formatHumanOffset,
  rebuildDeliveries,
  cancelPendingDeliveries,
  rebuildDatabaseDateReminderDeliveries,
  cancelDatabaseDateReminderDeliveries,
} from '../src/reminders.ts'

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
    $executeRaw: vi.fn().mockResolvedValue(1),
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
    id: '00000000-0000-4000-8000-000000000001',
    pageId: '22222222-2222-4222-9222-222222222222',
    workspaceId: '11111111-1111-4111-9111-111111111111',
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
    expect(vi.mocked(tx.notificationEvent.create)).toHaveBeenCalledTimes(2)
  })

  it('creates scheduled IN_APP deliveries even when the user has no email or push target', async () => {
    const tx = makeTx({
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ email: null, emailVerified: false }) },
    })
    const reminder = { ...baseReminder, offsets: [60] }

    await rebuildDeliveries(tx, reminder)

    expect(vi.mocked(tx.notificationEvent.create)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(tx.notificationDelivery.create)).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'IN_APP',
        userId: 'user-1',
        nextAttemptAt: new Date(reminder.dueAt.getTime() - 60 * 60_000),
      }),
    })
  })

  it('does not create the in-app notification while scheduling a future reminder', async () => {
    const tx = makeTx()

    await rebuildDeliveries(tx, { ...baseReminder, offsets: [60] })

    expect(vi.mocked(tx.notificationInApp.create)).not.toHaveBeenCalled()
  })

  it('skips offsets whose fireAt is already in the past', async () => {
    const tx = makeTx()
    const reminder = {
      ...baseReminder,
      dueAt: new Date(Date.now() + 30 * 60 * 1000),
      offsets: [1440, 0],
    }
    await rebuildDeliveries(tx, reminder)
    expect(vi.mocked(tx.notificationEvent.create)).toHaveBeenCalledTimes(1)
  })

  it('skips all deliveries when doneAt is set', async () => {
    const tx = makeTx()
    const reminder = { ...baseReminder, doneAt: new Date() }
    await rebuildDeliveries(tx, reminder)
    expect(vi.mocked(tx.notificationEvent.create)).not.toHaveBeenCalled()
  })

  it('resolves WORKSPACE audience to all current workspace members', async () => {
    const tx = makeTx({
      workspaceMember: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]),
      },
    })
    const reminder = { ...baseReminder, audience: 'WORKSPACE' as const, offsets: [0] }
    await rebuildDeliveries(tx, reminder)
    expect(vi.mocked(tx.notificationEvent.create)).toHaveBeenCalledTimes(2)
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
    expect(vi.mocked(tx.notificationEvent.create)).toHaveBeenCalledTimes(2)
  })
})

describe('cancelPendingDeliveries', () => {
  it('updates matching pending deliveries to SKIPPED', async () => {
    const tx = makeTx()
    await cancelPendingDeliveries(tx, ['rem-1', 'rem-2'], 'test reason')

    const executeRaw = vi.mocked(tx.$executeRaw)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const values = executeRaw.mock.calls[0]?.slice(1)
    expect(values).toEqual(expect.arrayContaining(['test reason', ['rem-1', 'rem-2']]))
  })

  it('is a no-op for an empty reminder list', async () => {
    const tx = makeTx()
    await cancelPendingDeliveries(tx, [], 'test')
    expect(vi.mocked(tx.$executeRaw)).not.toHaveBeenCalled()
  })
})

describe('rebuildDatabaseDateReminderDeliveries', () => {
  const baseConfig = {
    reminderId: '00000000-0000-4000-8000-0000000000aa',
    workspaceId: '11111111-1111-4111-9111-111111111111',
    pageId: '22222222-2222-4222-9222-222222222222',
    rowId: '33333333-3333-4333-9333-333333333333',
    propertyId: '44444444-4444-4444-9444-444444444444',
    userId: 'user-1',
    offsetMinutes: 60,
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    label: 'Срок',
  }

  beforeEach(() => vi.clearAllMocks())

  it('creates an IN_APP delivery with nextAttemptAt = dueAt - offset for a future date', async () => {
    const tx = makeTx()
    await rebuildDatabaseDateReminderDeliveries(tx, baseConfig)
    expect(vi.mocked(tx.notificationEvent.create)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(tx.notificationDelivery.create)).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: 'IN_APP',
        userId: 'user-1',
        nextAttemptAt: new Date(baseConfig.dueAt.getTime() - 60 * 60_000),
      }),
    })
  })

  it('keys the event payload on databaseReminderId (the delivery key)', async () => {
    const tx = makeTx()
    await rebuildDatabaseDateReminderDeliveries(tx, baseConfig)
    const createCall = vi.mocked(tx.notificationEvent.create).mock.calls[0]?.[0] as {
      data: { type: string; payload: { databaseReminderId: string } }
    }
    expect(createCall.data.type).toBe('DATABASE_DATE_REMINDER')
    expect(createCall.data.payload.databaseReminderId).toBe(baseConfig.reminderId)
  })

  it('cancels deliveries (no event created) when the date cell is empty (dueAt null)', async () => {
    const tx = makeTx()
    await rebuildDatabaseDateReminderDeliveries(tx, { ...baseConfig, dueAt: null })
    expect(vi.mocked(tx.notificationEvent.create)).not.toHaveBeenCalled()
    expect(vi.mocked(tx.$executeRaw)).toHaveBeenCalledTimes(1)
  })

  it('does not create a new delivery for a fire point already in the past', async () => {
    const tx = makeTx()
    // dueAt 5 min from now, offset 60 min → fireAt is ~55 min in the past.
    await rebuildDatabaseDateReminderDeliveries(tx, {
      ...baseConfig,
      dueAt: new Date(Date.now() + 5 * 60 * 1000),
      offsetMinutes: 60,
    })
    expect(vi.mocked(tx.notificationEvent.create)).not.toHaveBeenCalled()
  })

  it('reschedules an existing pending delivery to the new fireAt', async () => {
    const existing = [
      {
        id: 'del-existing',
        userId: 'user-1',
        channel: 'IN_APP',
        targetSubscriptionId: null,
        nextAttemptAt: new Date(0),
        event: { payload: { databaseReminderId: baseConfig.reminderId } },
      },
    ]
    const tx = makeTx({
      // No email/push target → only the IN_APP channel is wanted, which the
      // existing pending delivery already covers (so it is rescheduled, not
      // re-created).
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ email: null, emailVerified: false }) },
      notificationDelivery: {
        findMany: vi.fn().mockResolvedValue(existing),
        create: vi.fn().mockResolvedValue({ id: 'del-1' }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })
    await rebuildDatabaseDateReminderDeliveries(tx, baseConfig)
    expect(vi.mocked(tx.notificationDelivery.update)).toHaveBeenCalledWith({
      where: { id: 'del-existing' },
      data: { nextAttemptAt: new Date(baseConfig.dueAt.getTime() - 60 * 60_000) },
    })
    // No NEW delivery created (the existing IN_APP one was reused).
    expect(vi.mocked(tx.notificationDelivery.create)).not.toHaveBeenCalled()
  })
})

describe('cancelDatabaseDateReminderDeliveries', () => {
  it('updates matching pending DATABASE_DATE_REMINDER deliveries to SKIPPED', async () => {
    const tx = makeTx()
    await cancelDatabaseDateReminderDeliveries(tx, ['cfg-1'], 'removed')
    const executeRaw = vi.mocked(tx.$executeRaw)
    expect(executeRaw).toHaveBeenCalledTimes(1)
    const values = executeRaw.mock.calls[0]?.slice(1)
    expect(values).toEqual(expect.arrayContaining(['removed', ['cfg-1']]))
  })

  it('is a no-op for an empty id list', async () => {
    const tx = makeTx()
    await cancelDatabaseDateReminderDeliveries(tx, [], 'x')
    expect(vi.mocked(tx.$executeRaw)).not.toHaveBeenCalled()
  })
})
