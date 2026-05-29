import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

// SP1 pattern: NO jest.unstable_mockModule. Import the service normally; the REAL
// @repo/domain functions run against a hand-mocked PrismaClient. The scheduler is
// stubbed via the @Optional() constructor param (Correction 2).
import { ReminderService } from './reminder.service.js'

function makeStubScheduler() {
  return {
    rebuild: jest.fn<(...a: unknown[]) => Promise<void>>(async () => undefined),
    cancel: jest.fn<(...a: unknown[]) => Promise<void>>(async () => undefined),
  }
}

function makeMockPrisma() {
  const txFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [{ id: 'r1' }])
  const txUpdateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 1 }))
  const txCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
    id: 'r1',
    pageId: 'p1',
    workspaceId: 'w1',
    createdById: 'u1',
    dueAt: new Date(),
    offsets: [0],
    audience: 'ME',
    label: null,
    recipients: [],
    doneAt: null,
  }))
  const txUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
    id: 'r1',
    dueAt: new Date(),
  }))
  const txRecipientFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const txRecipientDeleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const tx = {
    reminder: { create: txCreate, update: txUpdate, updateMany: txUpdateMany, findMany: txFindMany, findUnique: jest.fn() },
    reminderRecipient: { findMany: txRecipientFindMany, deleteMany: txRecipientDeleteMany },
  }
  const pageFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' }),
  )
  const reminderFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
    id: 'r1',
    pageId: 'p1',
    workspaceId: 'w1',
    createdById: 'u1',
    dueAt: new Date(),
    offsets: [0],
    audience: 'ME',
    label: null,
    doneAt: null,
  }))
  const reminderFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const $transaction = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async (fn: unknown) => (fn as (t: typeof tx) => unknown)(tx),
  )
  return {
    page: { findFirst: pageFindFirst },
    reminder: { findUnique: reminderFindUnique, findMany: reminderFindMany, updateMany: txUpdateMany },
    $transaction,
    __mocks: { txCreate, txUpdate, txUpdateMany, txFindMany, pageFindFirst, reminderFindUnique, reminderFindMany, $transaction },
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof jest.fn>> }
}

describe('ReminderService', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let stubScheduler: ReturnType<typeof makeStubScheduler>
  let svc: ReminderService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    stubScheduler = makeStubScheduler()
    // Pass stubScheduler as the @Optional() second param so real @repo/notifications is NOT called
    svc = new ReminderService(mockPrisma, stubScheduler)
  })

  it('createReminder creates reminder via prisma tx and calls stubScheduler.rebuild', async () => {
    const result = await svc.createReminder({
      userId: 'u1',
      workspaceId: 'w1',
      pageId: 'p1',
      dueAt: new Date(),
      offsets: [0],
      audience: 'ME',
    })
    expect(result).toBe('r1')
    expect(mockPrisma.__mocks.txCreate).toHaveBeenCalledTimes(1)
    expect(stubScheduler.rebuild).toHaveBeenCalledTimes(1)
    expect(stubScheduler.cancel).not.toHaveBeenCalled()
  })

  it('moveReminder updates dueAt in tx and calls stubScheduler.rebuild', async () => {
    const result = await svc.moveReminder({ userId: 'u1', reminderId: 'r1', dueAt: new Date() })
    expect(result.id).toBe('r1')
    expect(mockPrisma.__mocks.txUpdate).toHaveBeenCalledTimes(1)
    expect(stubScheduler.rebuild).toHaveBeenCalledTimes(1)
  })

  it('deleteReminder soft-deletes in tx and calls stubScheduler.cancel', async () => {
    const result = await svc.deleteReminder({ userId: 'u1', reminderId: 'r1' })
    expect(result).toEqual({ count: 1 })
    expect(stubScheduler.cancel).toHaveBeenCalledWith(expect.anything(), ['r1'], 'reminder removed')
  })

  it('deleteReminder passes full input shape ({ reminderIds, pageId }) to domain.deleteReminder', async () => {
    await svc.deleteReminder({ userId: 'u1', reminderIds: ['r1', 'r2'], all: true })
    expect(stubScheduler.cancel).toHaveBeenCalledTimes(1)
  })

  it('completeReminder calls stubScheduler.cancel with completed reason', async () => {
    mockPrisma.__mocks.txUpdateMany!.mockResolvedValue({ count: 1 })
    const result = await svc.completeReminder({ userId: 'u1', reminderId: 'r1' })
    expect(result).toEqual({ id: 'r1' })
    expect(stubScheduler.cancel).toHaveBeenCalledWith(expect.anything(), ['r1'], 'reminder completed')
  })

  it('listReminders uses direct Prisma (scheduler is never called)', async () => {
    mockPrisma.__mocks.reminderFindMany!.mockResolvedValue([])
    await svc.listReminders({ userId: 'u1' })
    expect(mockPrisma.__mocks.reminderFindMany).toHaveBeenCalled()
    expect(stubScheduler.rebuild).not.toHaveBeenCalled()
    expect(stubScheduler.cancel).not.toHaveBeenCalled()
  })
})
