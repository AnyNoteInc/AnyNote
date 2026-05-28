import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { ReminderService } from '../services/reminder.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

const CreateReminderInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  dueAt: z.coerce.date(),
  label: mcpInput(z.string().max(200).optional()),
  audience: mcpInput(z.enum(['ME', 'WORKSPACE', 'LIST']).default('ME')),
  offsets: mcpInput(z.array(z.number().int()).optional()),
})
const ListRemindersInput = z.object({
  workspaceId: mcpInput(z.string().uuid().optional()),
  pageId: mcpNullableUuidOptional(),
  includeDone: mcpInput(z.boolean().default(false)),
})
const MoveReminderInput = z.object({
  workspaceId: z.string().uuid(),
  reminderId: mcpUuid(),
  dueAt: mcpInput(z.coerce.date().optional()),
  shift: mcpInput(
    z
      .object({
        days: z.number().int().optional(),
        hours: z.number().int().optional(),
        minutes: z.number().int().optional(),
      })
      .optional(),
  ),
})
const DeleteReminderInput = z.object({
  workspaceId: z.string().uuid(),
  reminderId: mcpNullableUuidOptional(),
  reminderIds: mcpInput(z.array(z.string().uuid()).optional()),
  all: mcpInput(z.boolean().optional()),
  pageId: mcpNullableUuidOptional(),
})
const CompleteReminderInput = z.object({
  workspaceId: z.string().uuid(),
  reminderId: mcpUuid(),
})

type CreateReminderArgs = z.infer<typeof CreateReminderInput>
type ListRemindersArgs = z.infer<typeof ListRemindersInput>
type MoveReminderArgs = z.infer<typeof MoveReminderInput>
type DeleteReminderArgs = z.infer<typeof DeleteReminderInput>
type CompleteReminderArgs = z.infer<typeof CompleteReminderInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class ReminderTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly reminders: ReminderService,
  ) {}

  @Tool({
    name: 'createReminder',
    description:
      'Создаёт напоминание на странице с датой/временем срабатывания (dueAt, ISO 8601). ' +
      'Используй для протокола встречи: на каждое поручение со сроком ставь напоминание. ' +
      'Требует подтверждения. Параметры: workspaceId, pageId, dueAt, label (опц.), ' +
      'audience (ME|WORKSPACE|LIST, def ME), offsets (опц., секунды до dueAt).',
    parameters: CreateReminderInput,
  })
  createReminder(args: CreateReminderArgs, _context: Context, req: AuthedRequest) {
    return this.doCreateReminder(requireAuth(req), args)
  }

  async doCreateReminder(auth: AuthContext, args: CreateReminderArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const reminderId = await this.reminders.createReminder({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      dueAt: args.dueAt,
      label: args.label,
      audience: args.audience,
      offsets: args.offsets,
    })
    return { reminderId }
  }

  @Tool({
    name: 'listReminders',
    description:
      'Список моих напоминаний (созданных мной или где я получатель). По умолчанию ' +
      'только невыполненные в текущем воркспейсе; без workspaceId — по всем моим ' +
      'пространствам. Возвращает id, label, dueAt, done, page, workspace. ' +
      'Используй для "какие у меня напоминания". Параметры: workspaceId (опц.), ' +
      'pageId (опц.), includeDone (def false).',
    parameters: ListRemindersInput,
  })
  listReminders(args: ListRemindersArgs, _context: Context, req: AuthedRequest) {
    return this.doListReminders(requireAuth(req), args)
  }

  async doListReminders(auth: AuthContext, args: ListRemindersArgs) {
    if (args.workspaceId) await assertMember(this.prisma, auth.userId, args.workspaceId)
    const reminders = await this.reminders.listReminders({
      userId: auth.userId,
      workspaceId: args.workspaceId ?? undefined,
      pageId: args.pageId ?? undefined,
      includeDone: args.includeDone,
    })
    return { reminders }
  }

  @Tool({
    name: 'moveReminder',
    description:
      'Переносит срок напоминания. Укажи РОВНО ОДНО: dueAt (новая дата ISO) ИЛИ ' +
      'shift (относительный сдвиг {days,hours,minutes}). "сдвинь на 2 дня" → ' +
      'shift {days:2}; "на 5 часов" → shift {hours:5}. Требует подтверждения. ' +
      'Параметры: workspaceId, reminderId, dueAt? , shift?.',
    parameters: MoveReminderInput,
  })
  moveReminder(args: MoveReminderArgs, _context: Context, req: AuthedRequest) {
    return this.doMoveReminder(requireAuth(req), args)
  }

  async doMoveReminder(auth: AuthContext, args: MoveReminderArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const hasDue = args.dueAt != null
    const hasShift = args.shift != null
    if (hasDue === hasShift) {
      throw new BadRequestException('Provide exactly one of dueAt or shift')
    }
    return this.reminders.moveReminder({
      userId: auth.userId,
      reminderId: args.reminderId,
      dueAt: args.dueAt ?? undefined,
      shift: args.shift ?? undefined,
    })
  }

  @Tool({
    name: 'deleteReminder',
    description:
      'Удаляет мои напоминания (мягко). Укажи reminderId, или reminderIds[], или ' +
      'all:true (опц. вместе с pageId — все на странице). Требует подтверждения. ' +
      'Параметры: workspaceId, reminderId?, reminderIds?, all?, pageId?.',
    parameters: DeleteReminderInput,
  })
  deleteReminder(args: DeleteReminderArgs, _context: Context, req: AuthedRequest) {
    return this.doDeleteReminder(requireAuth(req), args)
  }

  async doDeleteReminder(auth: AuthContext, args: DeleteReminderArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const hasSelector = args.reminderId != null || (args.reminderIds?.length ?? 0) > 0 || args.all === true
    if (!hasSelector) {
      throw new BadRequestException('Provide reminderId, reminderIds, or all:true')
    }
    return this.reminders.deleteReminder({
      userId: auth.userId,
      reminderId: args.reminderId ?? undefined,
      reminderIds: args.reminderIds ?? undefined,
      all: args.all ?? undefined,
      pageId: args.pageId ?? undefined,
    })
  }

  @Tool({
    name: 'completeReminder',
    description: 'Отмечает напоминание выполненным. Параметры: workspaceId, reminderId.',
    parameters: CompleteReminderInput,
  })
  completeReminder(args: CompleteReminderArgs, _context: Context, req: AuthedRequest) {
    return this.doCompleteReminder(requireAuth(req), args)
  }

  async doCompleteReminder(auth: AuthContext, args: CompleteReminderArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.reminders.completeReminder({ userId: auth.userId, reminderId: args.reminderId })
  }
}
