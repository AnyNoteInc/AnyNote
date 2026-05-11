import { describe, expect, it, vi } from 'vitest'

import { isReminderEventStillValid } from '../../src/worker/dispatcher.ts'

describe('isReminderEventStillValid', () => {
  it('returns true for a non-reminder event', async () => {
    const prisma = { reminder: { findUnique: vi.fn() } }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'WORKSPACE_INVITE',
      payload: {},
    } as any)
    expect(res).toBe(true)
    expect(prisma.reminder.findUnique).not.toHaveBeenCalled()
  })

  it('returns false when reminder is missing', async () => {
    const prisma = { reminder: { findUnique: vi.fn().mockResolvedValue(null) } }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    } as any)
    expect(res).toBe(false)
  })

  it('returns false when reminder is soft-deleted', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({ deletedAt: new Date(), doneAt: null }),
      },
    }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    } as any)
    expect(res).toBe(false)
  })

  it('returns false when reminder is done', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({ deletedAt: null, doneAt: new Date() }),
      },
    }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    } as any)
    expect(res).toBe(false)
  })

  it('returns true for an active reminder', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({ deletedAt: null, doneAt: null }),
      },
    }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    } as any)
    expect(res).toBe(true)
  })
})
