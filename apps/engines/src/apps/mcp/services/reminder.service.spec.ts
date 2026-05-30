import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

// The domain singleton now owns prisma + scheduler internally.
// ReminderService delegates to domain.reminders.*; listReminders uses this.prisma directly.
import { ReminderService } from './reminder.service.js'

function makeFakeDomain(): Domain {
  return {
    reminders: {
      create: jest.fn<(...a: unknown[]) => Promise<{ reminderId: string }>>(
        async () => ({ reminderId: 'r1' }),
      ),
      move: jest.fn<(...a: unknown[]) => Promise<{ id: string; dueAt: Date }>>(
        async () => ({ id: 'r1', dueAt: new Date('2026-01-01') }),
      ),
      remove: jest.fn<(...a: unknown[]) => Promise<{ count: number }>>(async () => ({ count: 1 })),
      complete: jest.fn<(...a: unknown[]) => Promise<{ id: string }>>(async () => ({ id: 'r1' })),
      sync: jest.fn<(...a: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true })),
    } as unknown as Domain['reminders'],
    favorites: {} as never,
    notifications: {} as never,
    workspace: {} as never,
    kanban: {} as Domain['kanban'],
    pages: {} as Domain['pages'],
    billing: {} as Domain['billing'],
  }
}

function makeMockPrisma() {
  return {
    reminder: {
      findMany: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => []),
    },
  } as unknown as PrismaClient & {
    reminder: { findMany: ReturnType<typeof jest.fn> }
  }
}

describe('ReminderService', () => {
  let domain: Domain
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let svc: ReminderService

  beforeEach(() => {
    jest.clearAllMocks()
    domain = makeFakeDomain()
    mockPrisma = makeMockPrisma()
    svc = new ReminderService(mockPrisma as unknown as PrismaClient, domain)
  })

  it('createReminder delegates to domain.reminders.create and surfaces reminderId', async () => {
    const result = await svc.createReminder({
      userId: 'u1',
      workspaceId: 'w1',
      pageId: 'p1',
      dueAt: new Date(),
      offsets: [0],
      audience: 'ME',
    })
    expect(result).toBe('r1')
    expect(domain.reminders.create).toHaveBeenCalledTimes(1)
    const [userId, input] = (domain.reminders.create as jest.Mock).mock.calls[0] as [
      string,
      unknown,
    ]
    expect(userId).toBe('u1')
    expect(input).toMatchObject({ pageId: 'p1', audience: 'ME', offsets: [0] })
  })

  it('moveReminder delegates to domain.reminders.move and returns id+dueAt', async () => {
    const dueAt = new Date()
    const result = await svc.moveReminder({ userId: 'u1', reminderId: 'r1', dueAt })
    expect(result.id).toBe('r1')
    expect(domain.reminders.move).toHaveBeenCalledTimes(1)
    const [userId, input] = (domain.reminders.move as jest.Mock).mock.calls[0] as [string, unknown]
    expect(userId).toBe('u1')
    expect(input).toMatchObject({ reminderId: 'r1', dueAt })
  })

  it('deleteReminder delegates to domain.reminders.remove and returns count', async () => {
    const result = await svc.deleteReminder({ userId: 'u1', reminderId: 'r1' })
    expect(result).toEqual({ count: 1 })
    expect(domain.reminders.remove).toHaveBeenCalledTimes(1)
    const [userId, input] = (domain.reminders.remove as jest.Mock).mock.calls[0] as [string, unknown]
    expect(userId).toBe('u1')
    expect(input).toMatchObject({ reminderId: 'r1' })
  })

  it('deleteReminder passes full input shape ({ reminderIds, all }) to domain.reminders.remove', async () => {
    await svc.deleteReminder({ userId: 'u1', reminderIds: ['r1', 'r2'], all: true })
    expect(domain.reminders.remove).toHaveBeenCalledTimes(1)
    const [, input] = (domain.reminders.remove as jest.Mock).mock.calls[0] as [string, unknown]
    expect(input).toMatchObject({ reminderIds: ['r1', 'r2'], all: true })
  })

  it('completeReminder delegates to domain.reminders.complete and returns id', async () => {
    const result = await svc.completeReminder({ userId: 'u1', reminderId: 'r1' })
    expect(result).toEqual({ id: 'r1' })
    expect(domain.reminders.complete).toHaveBeenCalledTimes(1)
    const [userId, input] = (domain.reminders.complete as jest.Mock).mock.calls[0] as [
      string,
      unknown,
    ]
    expect(userId).toBe('u1')
    expect(input).toMatchObject({ reminderId: 'r1' })
  })

  it('listReminders uses direct Prisma (domain is never called)', async () => {
    await svc.listReminders({ userId: 'u1' })
    expect(mockPrisma.reminder.findMany).toHaveBeenCalledTimes(1)
    expect(domain.reminders.create).not.toHaveBeenCalled()
    expect(domain.reminders.move).not.toHaveBeenCalled()
    expect(domain.reminders.remove).not.toHaveBeenCalled()
    expect(domain.reminders.complete).not.toHaveBeenCalled()
  })
})
