import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { DOMAIN } from '../../../infra/domain/domain.providers.js'

export type CreateReminderInput = {
  userId: string
  workspaceId: string
  pageId: string
  dueAt: Date
  label?: string | null
  audience?: 'ME' | 'WORKSPACE' | 'LIST'
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

@Injectable()
export class ReminderService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DOMAIN) private readonly domain: Domain,
  ) {}

  async createReminder(input: CreateReminderInput): Promise<string> {
    const result = await this.domain.reminders.create(input.userId, {
      pageId: input.pageId,
      dueAt: input.dueAt,
      offsets: input.offsets ?? [],
      audience: input.audience ?? 'ME',
      label: input.label ?? null,
    })
    return result.reminderId
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
    return this.domain.reminders.move(input.userId, {
      reminderId: input.reminderId,
      dueAt: input.dueAt,
      shift: input.shift,
    })
  }

  async deleteReminder(input: DeleteReminderInput): Promise<{ count: number }> {
    return this.domain.reminders.remove(input.userId, {
      reminderId: input.reminderId,
      reminderIds: input.reminderIds,
      all: input.all,
      pageId: input.pageId,
    })
  }

  async completeReminder(input: { userId: string; reminderId: string }): Promise<{ id: string }> {
    return this.domain.reminders.complete(input.userId, { reminderId: input.reminderId })
  }
}
