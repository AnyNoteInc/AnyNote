import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError, ReminderNotFoundError } from '../errors/mcp.errors.js'
import { ReminderService } from './reminder.service.js'

describe('ReminderService', () => {
  const pageFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderUpdateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    page: { findUnique: pageFindUnique },
    reminder: {
      create: reminderCreate,
      findUnique: reminderFindUnique,
      findMany: reminderFindMany,
      update: reminderUpdate,
      updateMany: reminderUpdateMany,
    },
  } as unknown as PrismaClient
  let svc: ReminderService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new ReminderService(prisma)
  })

  it('createReminder verifies the page belongs to the workspace', async () => {
    pageFindUnique.mockResolvedValue({ workspaceId: 'w-other' })
    await expect(
      svc.createReminder({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', dueAt: new Date('2026-06-01T10:00:00Z') }),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })

  it('createReminder creates with defaults', async () => {
    pageFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    reminderCreate.mockResolvedValue({ id: 'r1' })
    const id = await svc.createReminder({
      userId: 'u1', workspaceId: 'w1', pageId: 'p1', dueAt: new Date('2026-06-01T10:00:00Z'), label: 'Ship',
    })
    expect(id).toBe('r1')
    expect(reminderCreate).toHaveBeenCalledWith({
      data: {
        pageId: 'p1', workspaceId: 'w1', createdById: 'u1', label: 'Ship',
        dueAt: new Date('2026-06-01T10:00:00Z'), audience: 'ME', offsets: [],
      },
      select: { id: true },
    })
  })

  it('moveReminder shifts an owned reminder by a relative delta', async () => {
    reminderFindUnique.mockResolvedValue({ id: 'r1', createdById: 'u1', dueAt: new Date('2026-06-01T10:00:00Z') })
    reminderUpdate.mockResolvedValue({})
    const out = await svc.moveReminder({ userId: 'u1', reminderId: 'r1', shift: { days: 2, hours: 5 } })
    expect(out.dueAt).toEqual(new Date('2026-06-03T15:00:00Z'))
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { dueAt: new Date('2026-06-03T15:00:00Z') },
    })
  })

  it('moveReminder rejects a reminder owned by someone else', async () => {
    reminderFindUnique.mockResolvedValue({ id: 'r1', createdById: 'u2', dueAt: new Date() })
    await expect(
      svc.moveReminder({ userId: 'u1', reminderId: 'r1', shift: { days: 1 } }),
    ).rejects.toBeInstanceOf(ReminderNotFoundError)
  })

  it('deleteReminder soft-deletes owned reminders and returns the count', async () => {
    reminderUpdateMany.mockResolvedValue({ count: 3 })
    const out = await svc.deleteReminder({ userId: 'u1', all: true })
    expect(out.count).toBe(3)
    expect(reminderUpdateMany).toHaveBeenCalledWith({
      where: { createdById: 'u1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it('listReminders filters to my pending reminders and maps them', async () => {
    reminderFindMany.mockResolvedValue([
      { id: 'r1', label: 'Ship', dueAt: new Date('2026-06-01T10:00:00Z'), doneAt: null, page: { id: 'p1', title: 'P' }, workspace: { id: 'w1', name: 'W' } },
    ])
    const out = await svc.listReminders({ userId: 'u1', workspaceId: 'w1' })
    expect(out).toEqual([
      { id: 'r1', label: 'Ship', dueAt: new Date('2026-06-01T10:00:00Z'), done: false, page: { id: 'p1', title: 'P' }, workspace: { id: 'w1', name: 'W' } },
    ])
    const arg = reminderFindMany.mock.calls[0]![0] as { where: Record<string, unknown> }
    expect(arg.where).toMatchObject({ deletedAt: null, doneAt: null, workspaceId: 'w1' })
  })

  it('completeReminder marks done, or throws when nothing matched', async () => {
    reminderUpdateMany.mockResolvedValueOnce({ count: 1 })
    await expect(svc.completeReminder({ userId: 'u1', reminderId: 'r1' })).resolves.toEqual({ id: 'r1' })
    reminderUpdateMany.mockResolvedValueOnce({ count: 0 })
    await expect(svc.completeReminder({ userId: 'u1', reminderId: 'r1' })).rejects.toBeInstanceOf(ReminderNotFoundError)
  })

  it('deleteReminder merges reminderId and reminderIds into a single id filter', async () => {
    reminderUpdateMany.mockResolvedValue({ count: 2 })
    await svc.deleteReminder({ userId: 'u1', reminderId: 'r1', reminderIds: ['r2'] })
    const arg = reminderUpdateMany.mock.calls[0]![0] as { where: { id?: { in: string[] } } }
    expect(arg.where.id).toEqual({ in: ['r1', 'r2'] })
  })
})
