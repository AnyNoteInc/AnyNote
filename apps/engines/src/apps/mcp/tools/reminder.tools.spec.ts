import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { ReminderService } from '../services/reminder.service.js'
import { ReminderTools } from './reminder.tools.js'

describe('ReminderTools', () => {
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique } } as unknown as PrismaClient
  const createReminderMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const listRemindersMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const moveReminderMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const deleteReminderMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const completeReminderMock = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const service = {
    createReminder: createReminderMock,
    listReminders: listRemindersMock,
    moveReminder: moveReminderMock,
    deleteReminder: deleteReminderMock,
    completeReminder: completeReminderMock,
  } as unknown as ReminderService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: ReminderTools

  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new ReminderTools(prisma, service)
  })

  it('createReminder forwards to the service', async () => {
    createReminderMock.mockResolvedValue('r1')
    const out = await tools.createReminder(
      { workspaceId: 'w1', pageId: 'p1', dueAt: new Date('2026-06-01T10:00:00Z'), audience: 'ME' },
      {} as never,
      req,
    )
    expect(out).toEqual({ reminderId: 'r1' })
    expect(service.createReminder).toHaveBeenCalled()
  })

  it('moveReminder rejects when neither dueAt nor shift is provided', async () => {
    await expect(
      tools.moveReminder({ workspaceId: 'w1', reminderId: 'r1' }, {} as never, req),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('moveReminder rejects when both dueAt and shift are provided', async () => {
    await expect(
      tools.moveReminder(
        { workspaceId: 'w1', reminderId: 'r1', dueAt: new Date(), shift: { days: 1 } },
        {} as never,
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('deleteReminder rejects when no selector is provided', async () => {
    await expect(
      tools.deleteReminder({ workspaceId: 'w1' }, {} as never, req),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a non-member caller', async () => {
    findUnique.mockResolvedValue(null)
    await expect(
      tools.createReminder({ workspaceId: 'w1', pageId: 'p1', dueAt: new Date(), audience: 'ME' }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
