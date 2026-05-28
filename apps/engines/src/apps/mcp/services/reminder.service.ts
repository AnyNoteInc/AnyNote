import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError, ReminderNotFoundError } from '../errors/mcp.errors.js'

type Audience = 'ME' | 'WORKSPACE' | 'LIST'

export type CreateReminderInput = {
  userId: string
  workspaceId: string
  pageId: string
  dueAt: Date
  label?: string | null
  audience?: Audience
  offsets?: number[]
}
export type ListRemindersInput = {
  userId: string
  workspaceId?: string
  pageId?: string
  includeDone?: boolean
}
export type MoveReminderInput = {
  userId: string
  reminderId: string
  dueAt?: Date
  shift?: { days?: number; hours?: number; minutes?: number }
}
export type DeleteReminderInput = {
  userId: string
  reminderId?: string
  reminderIds?: string[]
  all?: boolean
  pageId?: string
}

function shiftMs(shift: { days?: number; hours?: number; minutes?: number }): number {
  return (shift.days ?? 0) * 86_400_000 + (shift.hours ?? 0) * 3_600_000 + (shift.minutes ?? 0) * 60_000
}

@Injectable()
export class ReminderService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async createReminder(input: CreateReminderInput): Promise<string> {
    const page = await this.prisma.page.findUnique({
      where: { id: input.pageId },
      select: { workspaceId: true },
    })
    if (!page || page.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
    const reminder = await this.prisma.reminder.create({
      data: {
        pageId: input.pageId,
        workspaceId: input.workspaceId,
        createdById: input.userId,
        label: input.label ?? null,
        dueAt: input.dueAt,
        audience: input.audience ?? 'ME',
        offsets: input.offsets ?? [],
      },
      select: { id: true },
    })
    return reminder.id
  }

  async listReminders(input: ListRemindersInput) {
    const rows = await this.prisma.reminder.findMany({
      where: {
        deletedAt: null,
        OR: [{ createdById: input.userId }, { recipients: { some: { userId: input.userId } } }],
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.pageId ? { pageId: input.pageId } : {}),
        ...(input.includeDone ? {} : { doneAt: null }),
      },
      select: {
        id: true,
        label: true,
        dueAt: true,
        doneAt: true,
        page: { select: { id: true, title: true } },
        workspace: { select: { id: true, name: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 200,
    })
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      dueAt: r.dueAt,
      done: r.doneAt != null,
      page: r.page,
      workspace: r.workspace,
    }))
  }

  async moveReminder(input: MoveReminderInput): Promise<{ id: string; dueAt: Date }> {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id: input.reminderId },
      select: { id: true, createdById: true, dueAt: true },
    })
    if (!reminder || reminder.createdById !== input.userId) throw new ReminderNotFoundError(input.reminderId)
    const dueAt = input.dueAt ?? new Date(reminder.dueAt.getTime() + shiftMs(input.shift ?? {}))
    await this.prisma.reminder.update({ where: { id: input.reminderId }, data: { dueAt } })
    return { id: input.reminderId, dueAt }
  }

  async deleteReminder(input: DeleteReminderInput): Promise<{ count: number }> {
    const ids = [...(input.reminderId ? [input.reminderId] : []), ...(input.reminderIds ?? [])]
    const result = await this.prisma.reminder.updateMany({
      where: {
        createdById: input.userId,
        deletedAt: null,
        ...(ids.length ? { id: { in: ids } } : {}),
        ...(input.pageId ? { pageId: input.pageId } : {}),
      },
      data: { deletedAt: new Date() },
    })
    return { count: result.count }
  }

  async completeReminder(input: { userId: string; reminderId: string }): Promise<{ id: string }> {
    const result = await this.prisma.reminder.updateMany({
      where: {
        id: input.reminderId,
        doneAt: null,
        OR: [{ createdById: input.userId }, { recipients: { some: { userId: input.userId } } }],
      },
      data: { doneAt: new Date(), doneById: input.userId },
    })
    if (result.count === 0) throw new ReminderNotFoundError(input.reminderId)
    return { id: input.reminderId }
  }
}
