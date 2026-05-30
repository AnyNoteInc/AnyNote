import { badRequest, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  CompleteReminderInput,
  CreateReminderInput,
  DeleteReminderInput,
  MoveReminderInput,
  ReminderForRebuildDto,
  SyncRemindersInput,
} from '../dto/reminders.dto.ts'
import type { DeliveryScheduler } from '../reminders.ports.ts'
import type { ReminderRepository } from '../repositories/reminders.repository.ts'

function shiftMs(shift: { days?: number; hours?: number; minutes?: number }): number {
  return (shift.days ?? 0) * 86_400_000 + (shift.hours ?? 0) * 3_600_000 + (shift.minutes ?? 0) * 60_000
}

function computeNewDueAt(
  existingDueAt: Date,
  input: { dueAt?: Date; shift?: { days?: number; hours?: number; minutes?: number } },
): Date {
  return input.dueAt ?? new Date(existingDueAt.getTime() + shiftMs(input.shift ?? {}))
}

export class ReminderService {
  private readonly repo: ReminderRepository
  private readonly uow: UnitOfWork
  private readonly scheduler: DeliveryScheduler
  constructor(repo: ReminderRepository, uow: UnitOfWork, scheduler: DeliveryScheduler) {
    this.repo = repo
    this.uow = uow
    this.scheduler = scheduler
  }

  async create(actorUserId: string, input: CreateReminderInput): Promise<{ reminderId: string }> {
    // Pre-transaction: assert page access
    const page = await this.repo.findAccessiblePage(actorUserId, input.pageId)
    if (!page) throw notFound('Страница не найдена')

    return this.uow.transaction(async () => {
      const forRebuild = await this.repo.createReminder({
        pageId: input.pageId,
        workspaceId: page.workspaceId,
        createdById: actorUserId,
        label: input.label,
        dueAt: input.dueAt,
        audience: input.audience,
        offsets: input.offsets,
      })
      await this.scheduler.rebuild(this.uow.client() as Parameters<DeliveryScheduler['rebuild']>[0], forRebuild)
      return { reminderId: forRebuild.id }
    })
  }

  async move(actorUserId: string, input: MoveReminderInput): Promise<{ id: string; dueAt: Date }> {
    // Pre-transaction: fetch existing and verify ownership
    const existing = await this.repo.findReminderForMove(input.reminderId)
    if (!existing || existing.createdById !== actorUserId) throw notFound('Напоминание не найдено')

    const newDueAt = computeNewDueAt(existing.dueAt, input)

    return this.uow.transaction(async () => {
      await this.repo.updateReminderDueAt(input.reminderId, newDueAt)
      const recipients = await this.repo.findReminderRecipients(input.reminderId)

      const forRebuild: ReminderForRebuildDto = {
        id: existing.id,
        pageId: existing.pageId,
        workspaceId: existing.workspaceId,
        createdById: existing.createdById,
        dueAt: newDueAt,
        offsets: existing.offsets,
        audience: existing.audience,
        label: existing.label,
        recipients,
        doneAt: existing.doneAt,
      }
      await this.scheduler.rebuild(this.uow.client() as Parameters<DeliveryScheduler['rebuild']>[0], forRebuild)
      return { id: input.reminderId, dueAt: newDueAt }
    })
  }

  async remove(actorUserId: string, input: DeleteReminderInput): Promise<{ count: number }> {
    const ids = [...(input.reminderId ? [input.reminderId] : []), ...(input.reminderIds ?? [])]
    const where = {
      createdById: actorUserId,
      deletedAt: null as null,
      ...(ids.length ? { id: { in: ids } } : {}),
      ...(input.pageId ? { pageId: input.pageId } : {}),
    }

    return this.uow.transaction(async () => {
      const matchedIds = await this.repo.findDeleteWhereMatchedIds(where)
      const result = await this.repo.softDeleteMany(where)
      if (matchedIds.length) {
        await this.scheduler.cancel(
          this.uow.client() as Parameters<DeliveryScheduler['cancel']>[0],
          matchedIds,
          'reminder removed',
        )
      }
      return { count: result.count }
    })
  }

  async complete(actorUserId: string, input: CompleteReminderInput): Promise<{ id: string }> {
    return this.uow.transaction(async () => {
      const result = await this.repo.completeReminderIfOwnerOrRecipient(input.reminderId, actorUserId)
      if (result.count === 0) throw notFound('Напоминание не найдено')
      await this.scheduler.cancel(
        this.uow.client() as Parameters<DeliveryScheduler['cancel']>[0],
        [input.reminderId],
        'reminder completed',
      )
      return { id: input.reminderId }
    })
  }

  async sync(actorUserId: string, input: SyncRemindersInput): Promise<{ ok: true }> {
    // Pre-transaction: resolve workspaceId
    const workspaceId = await this.repo.findPageWorkspaceId(input.pageId)

    // Pre-transaction: membership check
    const member = await this.repo.findWorkspaceMember(workspaceId, actorUserId)
    if (!member || !(['OWNER', 'ADMIN', 'EDITOR'] as string[]).includes(member.role)) {
      throw forbidden('Недостаточно прав')
    }

    // Pre-transaction: validate LIST recipients are workspace members
    const listRemindersWithRecipients = input.reminders.filter(
      (r) => r.audience === 'LIST' && r.recipients.length > 0,
    )
    if (listRemindersWithRecipients.length > 0) {
      const allRecipientIds = Array.from(
        new Set(listRemindersWithRecipients.flatMap((r) => r.recipients)),
      )
      const memberIds = await this.repo.findWorkspaceMembersInSet(workspaceId, allRecipientIds)
      const memberSet = new Set(memberIds)
      const invalid = allRecipientIds.filter((id) => !memberSet.has(id))
      if (invalid.length > 0) {
        throw badRequest(`Some recipients are not workspace members: ${invalid.join(', ')}`)
      }
    }

    await this.uow.transaction(async () => {
      const existing = await this.repo.findPageReminders(input.pageId)
      const existingById = new Map(existing.map((r) => [r.id, r]))
      const incomingIds = new Set(input.reminders.map((r) => r.id))

      for (const r of input.reminders) {
        const prev = existingById.get(r.id)
        await this.repo.upsertReminder({
          id: r.id,
          pageId: input.pageId,
          workspaceId,
          createdById: prev?.createdById ?? actorUserId,
          dueAt: new Date(r.dueAt),
          offsets: r.offsets,
          audience: r.audience,
          label: r.label,
          doneAt: r.doneAt ? new Date(r.doneAt) : null,
          prevDoneAt: prev?.doneAt,
          actorUserId,
        })

        await this.repo.replaceReminderRecipients(r.id, r.audience, r.recipients)

        const forRebuild: ReminderForRebuildDto = {
          id: r.id,
          pageId: input.pageId,
          workspaceId,
          createdById: prev?.createdById ?? actorUserId,
          dueAt: new Date(r.dueAt),
          offsets: r.offsets,
          audience: r.audience,
          label: r.label,
          recipients: r.recipients,
          doneAt: r.doneAt ? new Date(r.doneAt) : null,
        }
        await this.scheduler.rebuild(this.uow.client() as Parameters<DeliveryScheduler['rebuild']>[0], forRebuild)
      }

      const toDelete = [...existingById.keys()].filter((id) => !incomingIds.has(id))
      if (toDelete.length) {
        await this.repo.softDeleteManyByIds(toDelete)
        await this.scheduler.cancel(
          this.uow.client() as Parameters<DeliveryScheduler['cancel']>[0],
          toDelete,
          'reminder removed',
        )
      }
    })

    return { ok: true }
  }
}
