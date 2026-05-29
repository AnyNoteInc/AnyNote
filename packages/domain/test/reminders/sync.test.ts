import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { syncReminders } from '../../src/reminders/sync.ts'
import type { DeliveryScheduler } from '../../src/reminders/ports.ts'

function makeScheduler(): DeliveryScheduler & { rebuild: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  return { rebuild: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
}

function makePrisma(memberRole: string | null = 'EDITOR') {
  const pageData = { workspaceId: 'w1' }
  const memberData = memberRole ? { userId: 'u1', role: memberRole } : null

  const txReminder = {
    findMany: vi.fn(async () => []),
    upsert: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
  }
  const txRecipient = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: vi.fn(async () => ({ count: 0 })),
  }
  const txMember = {
    findMany: vi.fn(async () => (memberData ? [memberData] : [])),
  }
  const tx = { reminder: txReminder, reminderRecipient: txRecipient, workspaceMember: txMember }

  return {
    page: { findUniqueOrThrow: vi.fn(async () => pageData) },
    workspaceMember: { findUnique: vi.fn(async () => memberData), findMany: vi.fn(async () => (memberData ? [memberData] : [])) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    __tx: tx,
  } as unknown as PrismaClient & { __tx: typeof tx }
}

describe('domain reminders syncReminders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws FORBIDDEN when user is not OWNER/ADMIN/EDITOR', async () => {
    const prisma = makePrisma('VIEWER')
    const sched = makeScheduler()
    await expect(
      syncReminders(prisma, 'u1', { pageId: 'p1', reminders: [] }, sched),
    ).rejects.toBeInstanceOf(DomainError)
    expect(sched.rebuild).not.toHaveBeenCalled()
  })

  it('throws BAD_REQUEST when LIST recipients are not workspace members', async () => {
    const prisma = makePrisma('EDITOR')
    ;(prisma.workspaceMember.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const sched = makeScheduler()
    const reminder = {
      id: 'r1',
      dueAt: new Date().toISOString(),
      offsets: [0],
      audience: 'LIST' as const,
      label: null,
      recipients: ['non-member-uuid-0001-000000000000'],
      doneAt: null,
    }
    await expect(
      syncReminders(prisma, 'u1', { pageId: 'p1', reminders: [reminder] }, sched),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('upserts reminders and calls scheduler.rebuild for each', async () => {
    const prisma = makePrisma('EDITOR')
    const sched = makeScheduler()
    const reminder = {
      id: 'r1',
      dueAt: new Date().toISOString(),
      offsets: [0],
      audience: 'ME' as const,
      label: 'Test',
      recipients: [],
      doneAt: null,
    }
    const result = await syncReminders(prisma, 'u1', { pageId: 'p1', reminders: [reminder] }, sched)
    expect(result).toEqual({ ok: true })
    expect(sched.rebuild).toHaveBeenCalledOnce()
  })

  it('calls scheduler.cancel for reminders removed from the list', async () => {
    const prisma = makePrisma('EDITOR')
    ;(prisma as unknown as { __tx: { reminder: { findMany: ReturnType<typeof vi.fn> } } }).__tx.reminder.findMany.mockResolvedValue([
      { id: 'old-r', deletedAt: null, doneAt: null, dueAt: new Date(), offsets: [], audience: 'ME', createdById: 'u1' },
    ])
    const sched = makeScheduler()
    // No reminders in the incoming list — old-r should be deleted
    const result = await syncReminders(prisma, 'u1', { pageId: 'p1', reminders: [] }, sched)
    expect(result).toEqual({ ok: true })
    expect(sched.cancel).toHaveBeenCalledWith(expect.anything(), ['old-r'], 'reminder removed')
  })
})
