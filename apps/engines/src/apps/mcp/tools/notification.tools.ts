import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import { z } from 'zod'

import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { NotificationService } from '../services/notification.service.js'
import { mcpInput } from '../utils/mcp-input.js'

const ListNotificationsInput = z.object({
  unreadOnly: mcpInput(z.boolean().default(true)),
  limit: mcpInput(z.number().int().positive().max(100).default(50)),
})
const MarkReadInput = z.object({
  all: mcpInput(z.boolean().optional()),
  ids: mcpInput(z.array(z.string().uuid()).optional()),
})

type ListNotificationsArgs = z.infer<typeof ListNotificationsInput>
type MarkReadArgs = z.infer<typeof MarkReadInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class NotificationTools {
  constructor(private readonly notifications: NotificationService) {}

  @Tool({
    name: 'listNotifications',
    description:
      'Список уведомлений пользователя (по всем пространствам). По умолчанию только ' +
      'непрочитанные. Возвращает id, type, category, resourceUrl, read, createdAt. ' +
      'Используй для "покажи мне уведомления". Параметры: unreadOnly (def true), limit (def 50).',
    parameters: ListNotificationsInput,
  })
  async listNotifications(args: ListNotificationsArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    const notifications = await this.notifications.list({
      userId: auth.userId,
      unreadOnly: args.unreadOnly,
      limit: args.limit,
    })
    return { notifications }
  }

  @Tool({
    name: 'markNotificationsRead',
    description:
      'Помечает уведомления прочитанными. Укажи all:true (все) или ids[] (конкретные). ' +
      'Используй для "прочитай все уведомления". Параметры: all?, ids?.',
    parameters: MarkReadInput,
  })
  async markNotificationsRead(args: MarkReadArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    if (args.all !== true && (args.ids?.length ?? 0) === 0) {
      throw new BadRequestException('Provide all:true or a non-empty ids array')
    }
    return this.notifications.markRead({ userId: auth.userId, all: args.all, ids: args.ids })
  }
}
