import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'

export type ListFavoritesInput = { userId: string; workspaceId?: string }
export type AddFavoriteInput = { userId: string; workspaceId: string; pageId: string }
export type RemoveFavoriteInput = { userId: string; pageId: string }

@Injectable()
export class FavoriteService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(input: ListFavoritesInput) {
    const rows = await this.prisma.favoritePage.findMany({
      where: { userId: input.userId, ...(input.workspaceId ? { page: { workspaceId: input.workspaceId } } : {}) },
      select: { page: { select: { id: true, title: true, type: true, icon: true, workspaceId: true } } },
      orderBy: { position: 'asc' },
      take: 200,
    })
    return rows.map((r) => ({
      pageId: r.page.id,
      title: r.page.title,
      type: r.page.type,
      icon: r.page.icon,
      workspaceId: r.page.workspaceId,
    }))
  }

  async add(input: AddFavoriteInput): Promise<{ ok: true }> {
    const page = await this.prisma.page.findUnique({
      where: { id: input.pageId },
      select: { workspaceId: true },
    })
    if (!page || page.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
    const agg = await this.prisma.favoritePage.aggregate({
      where: { userId: input.userId },
      _max: { position: true },
    })
    const position = (agg._max.position ?? 0) + 1
    await this.prisma.favoritePage.upsert({
      where: { userId_pageId: { userId: input.userId, pageId: input.pageId } },
      create: { userId: input.userId, pageId: input.pageId, position },
      update: {},
    })
    return { ok: true }
  }

  async remove(input: RemoveFavoriteInput): Promise<{ count: number }> {
    const result = await this.prisma.favoritePage.deleteMany({
      where: { userId: input.userId, pageId: input.pageId },
    })
    return { count: result.count }
  }
}
