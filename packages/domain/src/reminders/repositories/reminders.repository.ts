import type { ReminderAudience } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { ReminderForRebuildDto } from '../dto/reminders.dto.ts'

export class ReminderRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  async findAccessiblePage(
    userId: string,
    pageId: string,
  ): Promise<{ id: string; workspaceId: string } | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: pageId, workspace: { members: { some: { userId } } } },
      select: { id: true, workspaceId: true },
    })
    if (!row) return null
    return { id: row.id, workspaceId: row.workspaceId }
  }

  async findReminderForMove(reminderId: string): Promise<{
    id: string
    pageId: string
    workspaceId: string
    createdById: string | null
    dueAt: Date
    offsets: number[]
    audience: 'ME' | 'WORKSPACE' | 'LIST'
    label: string | null
    doneAt: Date | null
  } | null> {
    return this.uow.client().reminder.findUnique({
      where: { id: reminderId },
      select: {
        id: true,
        pageId: true,
        workspaceId: true,
        createdById: true,
        dueAt: true,
        offsets: true,
        audience: true,
        label: true,
        doneAt: true,
      },
    }) as Promise<{
      id: string
      pageId: string
      workspaceId: string
      createdById: string | null
      dueAt: Date
      offsets: number[]
      audience: 'ME' | 'WORKSPACE' | 'LIST'
      label: string | null
      doneAt: Date | null
    } | null>
  }

  async createReminder(
    input: {
      pageId: string
      workspaceId: string
      createdById: string
      label: string | null | undefined
      dueAt: Date
      audience: 'ME' | 'WORKSPACE' | 'LIST'
      offsets: number[]
    },
  ): Promise<ReminderForRebuildDto> {
    const reminder = await this.uow.client().reminder.create({
      data: {
        pageId: input.pageId,
        workspaceId: input.workspaceId,
        createdById: input.createdById,
        label: input.label ?? null,
        dueAt: input.dueAt,
        audience: input.audience,
        offsets: input.offsets,
      },
      select: {
        id: true,
        pageId: true,
        workspaceId: true,
        createdById: true,
        dueAt: true,
        offsets: true,
        audience: true,
        label: true,
        doneAt: true,
      },
    })
    return {
      id: reminder.id,
      pageId: reminder.pageId,
      workspaceId: reminder.workspaceId,
      createdById: reminder.createdById,
      dueAt: reminder.dueAt,
      offsets: reminder.offsets as number[],
      audience: reminder.audience,
      label: reminder.label,
      recipients: [],
      doneAt: null,
    }
  }

  async updateReminderDueAt(reminderId: string, dueAt: Date): Promise<void> {
    await this.uow.client().reminder.update({
      where: { id: reminderId },
      data: { dueAt },
    })
  }

  async findReminderRecipients(reminderId: string): Promise<string[]> {
    const rows = await this.uow.client().reminderRecipient.findMany({
      where: { reminderId },
      select: { userId: true },
    })
    return rows.map((r) => r.userId)
  }

  async findDeleteWhereMatchedIds(where: {
    createdById: string
    deletedAt: null
    id?: { in: string[] }
    pageId?: string
  }): Promise<string[]> {
    const matched = await this.uow.client().reminder.findMany({ where, select: { id: true } })
    return matched.map((r) => r.id)
  }

  async softDeleteMany(where: {
    createdById: string
    deletedAt: null
    id?: { in: string[] }
    pageId?: string
  }): Promise<{ count: number }> {
    return this.uow.client().reminder.updateMany({ where, data: { deletedAt: new Date() } })
  }

  async completeReminderIfOwnerOrRecipient(
    reminderId: string,
    actorUserId: string,
  ): Promise<{ count: number }> {
    return this.uow.client().reminder.updateMany({
      where: {
        id: reminderId,
        doneAt: null,
        OR: [{ createdById: actorUserId }, { recipients: { some: { userId: actorUserId } } }],
      },
      data: { doneAt: new Date(), doneById: actorUserId },
    })
  }

  // ── sync helpers ────────────────────────────────────────────────────────

  async findPageReminders(pageId: string): Promise<Array<{
    id: string
    deletedAt: Date | null
    doneAt: Date | null
    dueAt: Date
    offsets: number[]
    audience: ReminderAudience
    createdById: string | null
  }>> {
    return this.uow.client().reminder.findMany({
      where: { pageId },
      select: {
        id: true,
        deletedAt: true,
        doneAt: true,
        dueAt: true,
        offsets: true,
        audience: true,
        createdById: true,
      },
    }) as Promise<Array<{
      id: string
      deletedAt: Date | null
      doneAt: Date | null
      dueAt: Date
      offsets: number[]
      audience: ReminderAudience
      createdById: string | null
    }>>
  }

  async upsertReminder(params: {
    id: string
    pageId: string
    workspaceId: string
    createdById: string
    dueAt: Date
    offsets: number[]
    audience: ReminderAudience
    label: string | null
    doneAt: Date | null
    prevDoneAt: Date | null | undefined
    actorUserId: string
  }): Promise<void> {
    await this.uow.client().reminder.upsert({
      where: { id: params.id },
      create: {
        id: params.id,
        pageId: params.pageId,
        workspaceId: params.workspaceId,
        createdById: params.createdById,
        dueAt: params.dueAt,
        offsets: params.offsets,
        audience: params.audience,
        label: params.label,
        doneAt: params.doneAt,
        doneById: params.doneAt ? params.actorUserId : null,
      },
      update: {
        dueAt: params.dueAt,
        offsets: params.offsets,
        audience: params.audience,
        label: params.label,
        doneAt: params.doneAt,
        deletedAt: null,
        doneById: params.doneAt && !params.prevDoneAt ? params.actorUserId : undefined,
      },
    })
  }

  async replaceReminderRecipients(reminderId: string, audience: ReminderAudience, recipients: string[]): Promise<void> {
    await this.uow.client().reminderRecipient.deleteMany({ where: { reminderId } })
    if (audience === 'LIST' && recipients.length) {
      await this.uow.client().reminderRecipient.createMany({
        data: recipients.map((uid) => ({ reminderId, userId: uid })),
      })
    }
  }

  async softDeleteManyByIds(ids: string[]): Promise<void> {
    if (!ids.length) return
    await this.uow.client().reminder.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  async findWorkspaceMember(
    workspaceId: string,
    userId: string,
  ): Promise<{ role: string } | null> {
    return this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
  }

  async findWorkspaceMembersInSet(workspaceId: string, userIds: string[]): Promise<string[]> {
    const rows = await this.uow.client().workspaceMember.findMany({
      where: { workspaceId, userId: { in: userIds } },
      select: { userId: true },
    })
    return rows.map((m) => m.userId)
  }

  async findPageWorkspaceId(pageId: string): Promise<string> {
    const page = await this.uow.client().page.findUniqueOrThrow({
      where: { id: pageId },
      select: { workspaceId: true },
    })
    return page.workspaceId
  }
}
