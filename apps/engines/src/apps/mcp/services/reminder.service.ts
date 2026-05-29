import { Inject, Injectable, Optional } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import * as domain from '@repo/domain'
import type { DeliveryScheduler } from '@repo/domain'
import { rebuildDeliveries, cancelPendingDeliveries } from '@repo/notifications'

import { PRISMA } from '../../../infra/db/db.providers.js'

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

const realScheduler: DeliveryScheduler = {
  rebuild: rebuildDeliveries,
  cancel: cancelPendingDeliveries,
}

@Injectable()
export class ReminderService {
  private readonly scheduler: DeliveryScheduler

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    // @Optional() so Nest resolves undefined in production → falls back to realScheduler.
    // Unit tests pass a stub scheduler as the second constructor arg (no DI change needed).
    // mcp.module.ts is UNCHANGED: @Optional() makes the unregistered param resolve to undefined → real.
    @Optional() scheduler?: DeliveryScheduler,
  ) {
    this.scheduler = scheduler ?? realScheduler
  }

  async createReminder(input: CreateReminderInput): Promise<string> {
    const result = await domain.createReminder(
      this.prisma,
      input.userId,
      {
        pageId: input.pageId,
        dueAt: input.dueAt,
        offsets: input.offsets ?? [],
        audience: input.audience ?? 'ME',
        label: input.label ?? null,
      },
      this.scheduler,
    )
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
    return domain.moveReminder(
      this.prisma,
      input.userId,
      { reminderId: input.reminderId, dueAt: input.dueAt, shift: input.shift },
      this.scheduler,
    )
  }

  async deleteReminder(input: DeleteReminderInput): Promise<{ count: number }> {
    // Delegates the full { reminderId, reminderIds, all, pageId } shape to domain.deleteReminder
    // which replicates the original engines where-clause and cancels matched deliveries atomically.
    return domain.deleteReminder(
      this.prisma,
      input.userId,
      {
        reminderId: input.reminderId,
        reminderIds: input.reminderIds,
        all: input.all,
        pageId: input.pageId,
      },
      this.scheduler,
    )
  }

  async completeReminder(input: { userId: string; reminderId: string }): Promise<{ id: string }> {
    return domain.completeReminder(
      this.prisma,
      input.userId,
      { reminderId: input.reminderId },
      this.scheduler,
    )
  }
}
