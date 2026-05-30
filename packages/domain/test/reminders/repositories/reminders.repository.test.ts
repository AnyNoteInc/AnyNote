import { describe, it, expect, vi } from 'vitest'

import { ReminderRepository } from '../../../src/reminders/repositories/reminders.repository.ts'
import { makeDelegateUow as makeUow } from '../../helpers.ts'

const baseReminder = {
  id: 'r1',
  pageId: 'p1',
  workspaceId: 'w1',
  createdById: 'u1',
  dueAt: new Date('2026-01-01T10:00:00Z'),
  offsets: [0, 60],
  audience: 'ME' as const,
  label: 'Test reminder',
  doneAt: null,
  deletedAt: null,
}

describe('ReminderRepository.findAccessiblePage', () => {
  it('maps the row to { id, workspaceId }', async () => {
    const findFirst = vi.fn(async () => ({ id: 'p1', workspaceId: 'w1' }))
    const repo = new ReminderRepository(makeUow({ page: { findFirst } }))
    const result = await repo.findAccessiblePage('u1', 'p1')
    expect(result).toEqual({ id: 'p1', workspaceId: 'w1' })
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', workspace: { members: { some: { userId: 'u1' } } } },
      select: { id: true, workspaceId: true },
    })
  })

  it('returns null when the page is not found or inaccessible', async () => {
    const findFirst = vi.fn(async () => null)
    const repo = new ReminderRepository(makeUow({ page: { findFirst } }))
    expect(await repo.findAccessiblePage('u1', 'p1')).toBeNull()
  })
})

describe('ReminderRepository.findReminderForMove', () => {
  it('returns the reminder row', async () => {
    const findUnique = vi.fn(async () => baseReminder)
    const repo = new ReminderRepository(makeUow({ reminder: { findUnique } }))
    const result = await repo.findReminderForMove('r1')
    expect(result?.id).toBe('r1')
    expect(result?.createdById).toBe('u1')
  })

  it('returns null when reminder does not exist', async () => {
    const findUnique = vi.fn(async () => null)
    const repo = new ReminderRepository(makeUow({ reminder: { findUnique } }))
    expect(await repo.findReminderForMove('no-id')).toBeNull()
  })
})

describe('ReminderRepository.createReminder', () => {
  it('creates a reminder and maps to ReminderForRebuildDto', async () => {
    const created = { ...baseReminder }
    const create = vi.fn(async () => created)
    const repo = new ReminderRepository(makeUow({ reminder: { create } }))
    const dto = await repo.createReminder({
      pageId: 'p1',
      workspaceId: 'w1',
      createdById: 'u1',
      label: 'Test reminder',
      dueAt: new Date('2026-01-01T10:00:00Z'),
      audience: 'ME',
      offsets: [0, 60],
    })
    expect(dto.id).toBe('r1')
    expect(dto.recipients).toEqual([])
    expect(dto.doneAt).toBeNull()
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('ReminderRepository.findDeleteWhereMatchedIds + softDeleteMany', () => {
  it('returns ids of matched reminders', async () => {
    const findMany = vi.fn(async () => [{ id: 'r1' }, { id: 'r2' }])
    const updateMany = vi.fn(async () => ({ count: 2 }))
    const repo = new ReminderRepository(makeUow({ reminder: { findMany, updateMany } }))
    const where = { createdById: 'u1', deletedAt: null }
    const ids = await repo.findDeleteWhereMatchedIds(where)
    expect(ids).toEqual(['r1', 'r2'])
    const result = await repo.softDeleteMany(where)
    expect(result.count).toBe(2)
  })
})

describe('ReminderRepository.completeReminderIfOwnerOrRecipient', () => {
  it('calls updateMany with OR condition and returns count', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const repo = new ReminderRepository(makeUow({ reminder: { updateMany } }))
    const result = await repo.completeReminderIfOwnerOrRecipient('r1', 'u1')
    expect(result.count).toBe(1)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
        data: expect.objectContaining({ doneById: 'u1' }),
      }),
    )
  })
})

describe('ReminderRepository.findPageReminders', () => {
  it('returns reminders for the page', async () => {
    const findMany = vi.fn(async () => [baseReminder])
    const repo = new ReminderRepository(makeUow({ reminder: { findMany } }))
    const result = await repo.findPageReminders('p1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('r1')
  })
})

describe('ReminderRepository.upsertReminder', () => {
  it('calls upsert with correct create/update shape', async () => {
    const upsert = vi.fn(async () => ({}))
    const repo = new ReminderRepository(makeUow({ reminder: { upsert } }))
    await repo.upsertReminder({
      id: 'r1',
      pageId: 'p1',
      workspaceId: 'w1',
      createdById: 'u1',
      dueAt: new Date('2026-01-01T10:00:00Z'),
      offsets: [0],
      audience: 'ME',
      label: null,
      doneAt: null,
      prevDoneAt: null,
      actorUserId: 'u1',
    })
    expect(upsert).toHaveBeenCalledOnce()
    const call = upsert.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'r1' })
    expect(call.create.pageId).toBe('p1')
    expect(call.update.deletedAt).toBeNull()
  })
})

describe('ReminderRepository.replaceReminderRecipients', () => {
  it('deletes existing recipients and creates new ones for LIST audience', async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }))
    const createMany = vi.fn(async () => ({ count: 1 }))
    const repo = new ReminderRepository(makeUow({ reminderRecipient: { deleteMany, createMany } }))
    await repo.replaceReminderRecipients('r1', 'LIST', ['u2'])
    expect(deleteMany).toHaveBeenCalledWith({ where: { reminderId: 'r1' } })
    expect(createMany).toHaveBeenCalledWith({ data: [{ reminderId: 'r1', userId: 'u2' }] })
  })

  it('does not call createMany for non-LIST audience', async () => {
    const deleteMany = vi.fn(async () => ({ count: 0 }))
    const createMany = vi.fn(async () => ({ count: 0 }))
    const repo = new ReminderRepository(makeUow({ reminderRecipient: { deleteMany, createMany } }))
    await repo.replaceReminderRecipients('r1', 'ME', [])
    expect(deleteMany).toHaveBeenCalledOnce()
    expect(createMany).not.toHaveBeenCalled()
  })
})
