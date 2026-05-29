import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { prisma } from '@repo/db'

import { ReminderService } from '../../src/apps/mcp/services/reminder.service.js'

/**
 * Proves the engines write path runs end-to-end against a real Postgres:
 *   ReminderService → @repo/domain → injected rebuildDeliveries → DB.
 * This is the only layer that exercises domain.createReminder against a live database —
 * unit suites both mock Prisma. Requires `docker compose up -d`.
 *
 * Fix validated: before this change, engines ReminderService.createReminder never wrote
 * notificationDelivery rows. After this change, at least one IN_APP delivery row exists.
 */
describe('Reminders engines → @repo/domain → DB (integration)', () => {
  const svc = new ReminderService(prisma)

  let workspaceId: string
  let userId: string
  let pageId: string

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: 'reminders-domain-int' } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: {
        name: 'Reminder User',
        firstName: 'R',
        lastName: 'U',
        email: `reminder-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: 'EDITOR' } })
    const page = await prisma.page.create({
      data: { workspaceId, title: 'Reminder Test', type: 'TEXT', createdById: userId, updatedById: userId },
    })
    pageId = page.id
  })

  afterEach(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('createReminder creates the reminder and schedules at least one IN_APP delivery row', async () => {
    const reminderId = await svc.createReminder({
      userId,
      workspaceId,
      pageId,
      dueAt: new Date(Date.now() + 3_600_000), // 1 hour from now
      offsets: [0],
      audience: 'ME',
    })

    expect(typeof reminderId).toBe('string')

    const reminder = await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } })
    expect(reminder.pageId).toBe(pageId)
    expect(reminder.workspaceId).toBe(workspaceId)
    expect(reminder.createdById).toBe(userId)

    // The key assertion: delivery scheduling now runs inside the domain transaction.
    const deliveries = await prisma.notificationDelivery.findMany({
      where: {
        event: {
          type: 'REMINDER_DUE',
          payload: { path: ['reminderId'], equals: reminderId },
        },
        status: 'PENDING',
        channel: 'IN_APP',
      },
    })
    expect(deliveries.length).toBeGreaterThanOrEqual(1)
  })
})
