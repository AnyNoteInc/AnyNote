import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { isReminderEventStillValid } from '../../src/worker/dispatcher.ts'

describe('isReminderEventStillValid', () => {
  it('returns true for a non-reminder event', async () => {
    const prisma = { reminder: { findUnique: vi.fn() } }
    const res = await isReminderEventStillValid(prisma as unknown as PrismaClient, {
      type: 'WORKSPACE_INVITE',
      payload: {},
    })
    expect(res).toBe(true)
    expect(prisma.reminder.findUnique).not.toHaveBeenCalled()
  })

  it('returns false when reminder is missing', async () => {
    const prisma = { reminder: { findUnique: vi.fn().mockResolvedValue(null) } }
    const res = await isReminderEventStillValid(prisma as unknown as PrismaClient, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    })
    expect(res).toBe(false)
  })

  it('returns false when reminder is soft-deleted', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: new Date(),
          doneAt: null,
          page: { deletedAt: null },
        }),
      },
    }
    const res = await isReminderEventStillValid(prisma as unknown as PrismaClient, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    })
    expect(res).toBe(false)
  })

  it('returns false when reminder is done', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          doneAt: new Date(),
          page: { deletedAt: null },
        }),
      },
    }
    const res = await isReminderEventStillValid(prisma as unknown as PrismaClient, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    })
    expect(res).toBe(false)
  })

  it('returns true for an active reminder', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          doneAt: null,
          dueAt: new Date('2026-06-01T10:00:00.000Z'),
          offsets: [60, 0],
          page: { deletedAt: null },
        }),
      },
    }
    const res = await isReminderEventStillValid(prisma as unknown as PrismaClient, {
      type: 'REMINDER_DUE',
      payload: {
        reminderId: 'rem-1',
        dueAt: '2026-06-01T10:00:00.000Z',
        offsetMinutes: 60,
      },
    })
    expect(res).toBe(true)
  })

  it('returns false when the reminder dueAt changed after the event was scheduled', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          doneAt: null,
          dueAt: new Date('2026-06-01T11:00:00.000Z'),
          offsets: [60, 0],
          page: { deletedAt: null },
        }),
      },
    }
    const res = await isReminderEventStillValid(prisma as unknown as PrismaClient, {
      type: 'REMINDER_DUE',
      payload: {
        reminderId: 'rem-1',
        dueAt: '2026-06-01T10:00:00.000Z',
        offsetMinutes: 60,
      },
    })
    expect(res).toBe(false)
  })

  it('returns false when the event offset is no longer configured on the reminder', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          doneAt: null,
          dueAt: new Date('2026-06-01T10:00:00.000Z'),
          offsets: [0],
          page: { deletedAt: null },
        }),
      },
    }
    const res = await isReminderEventStillValid(prisma as unknown as PrismaClient, {
      type: 'REMINDER_DUE',
      payload: {
        reminderId: 'rem-1',
        dueAt: '2026-06-01T10:00:00.000Z',
        offsetMinutes: 60,
      },
    })
    expect(res).toBe(false)
  })

  it('returns false when the page is soft-deleted', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({
          deletedAt: null,
          doneAt: null,
          page: { deletedAt: new Date() },
        }),
      },
    }
    const res = await isReminderEventStillValid(prisma as unknown as PrismaClient, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    })
    expect(res).toBe(false)
  })
})
