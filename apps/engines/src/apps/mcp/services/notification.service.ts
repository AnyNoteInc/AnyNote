import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import * as domain from '@repo/domain'

import { PRISMA } from '../../../infra/db/db.providers.js'

export type ListNotificationsInput = { userId: string; unreadOnly: boolean; limit: number }
export type MarkReadInput = { userId: string; all?: boolean; ids?: string[] }

@Injectable()
export class NotificationService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(input: ListNotificationsInput) {
    const rows = await this.prisma.notificationInApp.findMany({
      where: { userId: input.userId, ...(input.unreadOnly ? { readAt: null } : {}) },
      select: {
        id: true,
        readAt: true,
        createdAt: true,
        event: { select: { type: true, category: true, resourceUrl: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
    })
    return rows.map((r) => ({
      id: r.id,
      type: r.event.type,
      category: r.event.category,
      resourceUrl: r.event.resourceUrl,
      read: r.readAt != null,
      createdAt: r.createdAt,
    }))
  }

  async markRead(input: MarkReadInput): Promise<{ count: number }> {
    if (input.all) {
      const result = await domain.markAllRead(this.prisma, input.userId)
      return { count: result.updated }
    }
    const result = await domain.markRead(this.prisma, input.userId, { ids: input.ids ?? [] })
    return { count: result.updated }
  }
}
