import { describe, it, expect, vi, beforeEach } from 'vitest'

import { isDomainError } from '../../../src/shared/errors.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import type { DeliveryScheduler } from '../../../src/reminders/reminders.ports.ts'
import type { ReminderRepository } from '../../../src/reminders/repositories/reminders.repository.ts'
import { ReminderService } from '../../../src/reminders/services/reminders.service.ts'

// A minimal fake UoW: transaction() calls fn() immediately, client() returns a sentinel
const MOCK_CLIENT = Symbol('mock-tx-client')

function makeUow(): UnitOfWork {
  return {
    client: () => MOCK_CLIENT as never,
    transaction: async (fn) => fn(),
  }
}

function makeScheduler(): DeliveryScheduler & {
  rebuild: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
} {
  return { rebuild: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
}

const basePage = { id: 'p1', workspaceId: 'w1' }
const baseReminder = {
  id: 'r1',
  pageId: 'p1',
  workspaceId: 'w1',
  createdById: 'u1',
  dueAt: new Date('2026-01-01T10:00:00Z'),
  offsets: [0, 60],
  audience: 'ME' as const,
  label: null,
  doneAt: null,
  deletedAt: null,
}

function makeRepo(
  overrides: Partial<Record<keyof ReminderRepository, ReturnType<typeof vi.fn>>> = {},
): ReminderRepository {
  return {
    findAccessiblePage: vi.fn(async () => basePage),
    findReminderForMove: vi.fn(async () => baseReminder),
    computeNewDueAt: vi.fn((existing: Date, input: { dueAt?: Date }) => input.dueAt ?? existing),
    createReminder: vi.fn(async () => ({
      id: 'r1',
      pageId: 'p1',
      workspaceId: 'w1',
      createdById: 'u1',
      dueAt: new Date(),
      offsets: [],
      audience: 'ME' as const,
      label: null,
      recipients: [],
      doneAt: null,
    })),
    updateReminderDueAt: vi.fn(async () => undefined),
    findReminderRecipients: vi.fn(async () => [] as string[]),
    findDeleteWhereMatchedIds: vi.fn(async () => ['r1'] as string[]),
    softDeleteMany: vi.fn(async () => ({ count: 1 })),
    completeReminderIfOwnerOrRecipient: vi.fn(async () => ({ count: 1 })),
    findPageReminders: vi.fn(async () => []),
    upsertReminder: vi.fn(async () => undefined),
    replaceReminderRecipients: vi.fn(async () => undefined),
    softDeleteManyByIds: vi.fn(async () => undefined),
    findWorkspaceMember: vi.fn(async () => ({ role: 'EDITOR' })),
    findWorkspaceMembersInSet: vi.fn(async (_, ids: string[]) => ids),
    findPageWorkspaceId: vi.fn(async () => 'w1'),
    ...overrides,
  } as unknown as ReminderRepository
}

// ── create ────────────────────────────────────────────────────────────────

describe('ReminderService.create', () => {
  it('returns { reminderId } and calls scheduler.rebuild with the active client', async () => {
    const repo = makeRepo()
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    const result = await svc.create('u1', {
      pageId: 'p1',
      dueAt: new Date(),
      offsets: [],
      audience: 'ME',
    })

    expect(result).toEqual({ reminderId: 'r1' })
    expect(repo.createReminder).toHaveBeenCalledOnce()
    expect(sched.rebuild).toHaveBeenCalledOnce()
    // The active client sentinel should be passed to the scheduler
    expect(sched.rebuild).toHaveBeenCalledWith(MOCK_CLIENT, expect.any(Object))
  })

  it('throws NOT_FOUND when page is inaccessible and does NOT call scheduler', async () => {
    const repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    await expect(
      svc.create('u1', { pageId: 'p1', dueAt: new Date(), offsets: [], audience: 'ME' }),
    ).rejects.toSatisfy(isDomainError)

    expect(sched.rebuild).not.toHaveBeenCalled()
  })
})

// ── move ─────────────────────────────────────────────────────────────────

describe('ReminderService.move', () => {
  it('returns { id, dueAt } and calls scheduler.rebuild', async () => {
    const newDue = new Date('2026-02-01T00:00:00Z')
    const repo = makeRepo({
      computeNewDueAt: vi.fn(() => newDue),
    })
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    const result = await svc.move('u1', { reminderId: 'r1', dueAt: newDue })

    expect(result).toEqual({ id: 'r1', dueAt: newDue })
    expect(repo.updateReminderDueAt).toHaveBeenCalledWith('r1', newDue)
    expect(sched.rebuild).toHaveBeenCalledOnce()
    expect(sched.cancel).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when reminder does not exist', async () => {
    const repo = makeRepo({ findReminderForMove: vi.fn(async () => null) })
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    await expect(svc.move('u1', { reminderId: 'no-id' })).rejects.toMatchObject({
      httpStatus: 404,
      message: 'Напоминание не найдено',
    })
  })

  it('throws NOT_FOUND when reminder belongs to another user', async () => {
    const repo = makeRepo({
      findReminderForMove: vi.fn(async () => ({ ...baseReminder, createdById: 'OTHER' })),
    })
    const svc = new ReminderService(repo, makeUow(), makeScheduler())
    await expect(svc.move('u1', { reminderId: 'r1' })).rejects.toSatisfy(isDomainError)
  })

  it('passes recipients from repo to the scheduler forRebuild dto', async () => {
    const repo = makeRepo({
      findReminderRecipients: vi.fn(async () => ['u2', 'u3']),
    })
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    await svc.move('u1', { reminderId: 'r1', dueAt: new Date() })

    const [, forRebuild] = sched.rebuild.mock.calls[0]
    expect(forRebuild.recipients).toEqual(['u2', 'u3'])
  })
})

// ── remove ────────────────────────────────────────────────────────────────

describe('ReminderService.remove', () => {
  it('soft-deletes matched reminders and calls scheduler.cancel with matched ids', async () => {
    const repo = makeRepo()
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    const result = await svc.remove('u1', { reminderId: 'r1' })

    expect(result).toEqual({ count: 1 })
    expect(sched.cancel).toHaveBeenCalledWith(MOCK_CLIENT, ['r1'], 'reminder removed')
  })

  it('does not call scheduler.cancel when no reminders matched', async () => {
    const repo = makeRepo({
      findDeleteWhereMatchedIds: vi.fn(async () => [] as string[]),
      softDeleteMany: vi.fn(async () => ({ count: 0 })),
    })
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    const result = await svc.remove('u1', { reminderId: 'non-existent' })

    expect(result).toEqual({ count: 0 })
    expect(sched.cancel).not.toHaveBeenCalled()
  })

  it('supports reminderIds[] + pageId inputs', async () => {
    const repo = makeRepo()
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    await svc.remove('u1', { reminderIds: ['r1', 'r2'], pageId: 'p1' })

    expect(repo.findDeleteWhereMatchedIds).toHaveBeenCalledWith(
      expect.objectContaining({ id: { in: ['r1', 'r2'] }, pageId: 'p1' }),
    )
  })
})

// ── complete ──────────────────────────────────────────────────────────────

describe('ReminderService.complete', () => {
  it('returns { id } and calls scheduler.cancel', async () => {
    const repo = makeRepo()
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    const result = await svc.complete('u1', { reminderId: 'r1' })

    expect(result).toEqual({ id: 'r1' })
    expect(sched.cancel).toHaveBeenCalledWith(MOCK_CLIENT, ['r1'], 'reminder completed')
  })

  it('throws NOT_FOUND when updateMany returns count 0', async () => {
    const repo = makeRepo({
      completeReminderIfOwnerOrRecipient: vi.fn(async () => ({ count: 0 })),
    })
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    await expect(svc.complete('u1', { reminderId: 'r1' })).rejects.toMatchObject({
      httpStatus: 404,
      message: 'Напоминание не найдено',
    })
    expect(sched.cancel).not.toHaveBeenCalled()
  })
})

// ── sync ──────────────────────────────────────────────────────────────────

describe('ReminderService.sync', () => {
  it('throws FORBIDDEN when user is not OWNER/ADMIN/EDITOR', async () => {
    const repo = makeRepo({
      findWorkspaceMember: vi.fn(async () => ({ role: 'VIEWER' })),
    })
    const svc = new ReminderService(repo, makeUow(), makeScheduler())

    await expect(svc.sync('u1', { pageId: 'p1', reminders: [] })).rejects.toMatchObject({
      httpStatus: 403,
      message: 'Недостаточно прав',
    })
  })

  it('throws FORBIDDEN when user is not a workspace member', async () => {
    const repo = makeRepo({
      findWorkspaceMember: vi.fn(async () => null),
    })
    const svc = new ReminderService(repo, makeUow(), makeScheduler())

    await expect(svc.sync('u1', { pageId: 'p1', reminders: [] })).rejects.toSatisfy(isDomainError)
  })

  it('throws BAD_REQUEST when LIST recipients are not workspace members', async () => {
    const repo = makeRepo({
      findWorkspaceMembersInSet: vi.fn(async () => [] as string[]),
    })
    const svc = new ReminderService(repo, makeUow(), makeScheduler())

    await expect(
      svc.sync('u1', {
        pageId: 'p1',
        reminders: [
          {
            id: 'r1',
            dueAt: new Date().toISOString(),
            offsets: [],
            audience: 'LIST',
            label: null,
            recipients: ['non-member-uuid-0001-000000000000'],
            doneAt: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('upserts reminders and calls scheduler.rebuild for each', async () => {
    const repo = makeRepo()
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    const result = await svc.sync('u1', {
      pageId: 'p1',
      reminders: [
        {
          id: 'r1',
          dueAt: new Date().toISOString(),
          offsets: [],
          audience: 'ME',
          label: 'Test',
          recipients: [],
          doneAt: null,
        },
      ],
    })

    expect(result).toEqual({ ok: true })
    expect(repo.upsertReminder).toHaveBeenCalledOnce()
    expect(sched.rebuild).toHaveBeenCalledOnce()
    expect(sched.rebuild).toHaveBeenCalledWith(MOCK_CLIENT, expect.any(Object))
  })

  it('calls scheduler.cancel for reminders removed from the incoming list', async () => {
    const repo = makeRepo({
      findPageReminders: vi.fn(async () => [
        { id: 'old-r', deletedAt: null, doneAt: null, dueAt: new Date(), offsets: [], audience: 'ME', createdById: 'u1' },
      ]),
    })
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    await svc.sync('u1', { pageId: 'p1', reminders: [] })

    expect(repo.softDeleteManyByIds).toHaveBeenCalledWith(['old-r'])
    expect(sched.cancel).toHaveBeenCalledWith(MOCK_CLIENT, ['old-r'], 'reminder removed')
  })

  it('preserves createdById from prev when upserting existing reminders', async () => {
    const repo = makeRepo({
      findPageReminders: vi.fn(async () => [
        { id: 'r1', deletedAt: null, doneAt: null, dueAt: new Date(), offsets: [], audience: 'ME', createdById: 'original-creator' },
      ]),
    })
    const sched = makeScheduler()
    const svc = new ReminderService(repo, makeUow(), sched)

    await svc.sync('u1', {
      pageId: 'p1',
      reminders: [
        {
          id: 'r1',
          dueAt: new Date().toISOString(),
          offsets: [],
          audience: 'ME',
          label: null,
          recipients: [],
          doneAt: null,
        },
      ],
    })

    expect(repo.upsertReminder).toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 'original-creator' }),
    )
    const [, forRebuild] = sched.rebuild.mock.calls[0]
    expect(forRebuild.createdById).toBe('original-creator')
  })
})
