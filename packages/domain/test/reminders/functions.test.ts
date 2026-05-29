import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import {
  completeReminder,
  createReminder,
  deleteReminder,
  moveReminder,
} from '../../src/reminders/functions.ts'
import type { DeliveryScheduler } from '../../src/reminders/ports.ts'

function makeScheduler(): DeliveryScheduler & { rebuild: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  return { rebuild: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
}

function makePrisma() {
  const txReminder = {
    create: vi.fn(async () => ({ id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'u1', dueAt: new Date(), offsets: [0], audience: 'ME' as const, label: null, recipients: [], doneAt: null })),
    update: vi.fn(async () => ({ id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'u1', dueAt: new Date(), offsets: [0], audience: 'ME' as const, label: null, doneAt: null })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async () => ({ id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'u1', dueAt: new Date(), offsets: [0], audience: 'ME' as const, label: null, doneAt: null })),
    // findMany used by deleteReminder to get matched ids before cancel
    findMany: vi.fn(async () => [{ id: 'r1' }]),
  }
  const txRecipient = { deleteMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => [] as { userId: string }[]) }
  const tx = { reminder: txReminder, reminderRecipient: txRecipient }
  return {
    page: { findFirst: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' })) },
    reminder: {
      findUnique: vi.fn(async () => ({ id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'u1', dueAt: new Date(), offsets: [0], audience: 'ME' as const, label: null, doneAt: null })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    __tx: tx,
  } as unknown as PrismaClient & { __tx: typeof tx }
}

describe('domain reminders granular', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createReminder: creates reminder inside transaction and calls scheduler.rebuild', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    const result = await createReminder(
      prisma,
      'u1',
      { pageId: 'p1', dueAt: new Date(), offsets: [0], audience: 'ME', label: null },
      sched,
    )
    expect(result).toEqual({ reminderId: 'r1' })
    expect(sched.rebuild).toHaveBeenCalledOnce()
  })

  it('createReminder: throws NOT_FOUND when page not accessible', async () => {
    const prisma = makePrisma()
    ;(prisma.page.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const sched = makeScheduler()
    await expect(
      createReminder(prisma, 'u1', { pageId: 'p1', dueAt: new Date(), offsets: [], audience: 'ME', label: null }, sched),
    ).rejects.toBeInstanceOf(DomainError)
    expect(sched.rebuild).not.toHaveBeenCalled()
  })

  it('moveReminder: updates dueAt and calls scheduler.rebuild', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    const newDue = new Date(Date.now() + 86_400_000)
    const result = await moveReminder(prisma, 'u1', { reminderId: 'r1', dueAt: newDue }, sched)
    expect(result.id).toBe('r1')
    expect(sched.rebuild).toHaveBeenCalledOnce()
    expect(sched.cancel).not.toHaveBeenCalled()
  })

  it('moveReminder: throws NOT_FOUND when reminder belongs to another user', async () => {
    const prisma = makePrisma()
    ;(prisma.reminder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'OTHER', dueAt: new Date(), offsets: [], audience: 'ME', label: null, doneAt: null },
    )
    const sched = makeScheduler()
    await expect(
      moveReminder(prisma, 'u1', { reminderId: 'r1', dueAt: new Date() }, sched),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('deleteReminder: soft-deletes and calls scheduler.cancel with matched ids', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    // tx.reminder.findMany returns [{ id: 'r1' }], so cancel should be called with ['r1']
    const result = await deleteReminder(prisma, 'u1', { reminderId: 'r1' }, sched)
    expect(result).toEqual({ count: 1 })
    expect(sched.cancel).toHaveBeenCalledWith(expect.anything(), ['r1'], 'reminder removed')
  })

  it('deleteReminder: supports full input shape (reminderIds, pageId)', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    const result = await deleteReminder(
      prisma,
      'u1',
      { reminderIds: ['r1', 'r2'], pageId: 'p1' },
      sched,
    )
    expect(result).toEqual({ count: 1 })
    expect(sched.cancel).toHaveBeenCalledOnce()
  })

  it('completeReminder: sets doneAt and calls scheduler.cancel', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    const result = await completeReminder(prisma, 'u1', { reminderId: 'r1' }, sched)
    expect(result).toEqual({ id: 'r1' })
    expect(sched.cancel).toHaveBeenCalledWith(expect.anything(), ['r1'], 'reminder completed')
  })

  it('completeReminder: throws NOT_FOUND when updateMany returns count 0', async () => {
    const prisma = makePrisma()
    ;(prisma as unknown as { __tx: { reminder: { updateMany: ReturnType<typeof vi.fn> } } }).__tx.reminder.updateMany.mockResolvedValue({ count: 0 })
    const sched = makeScheduler()
    await expect(completeReminder(prisma, 'u1', { reminderId: 'r1' }, sched)).rejects.toBeInstanceOf(DomainError)
  })
})
