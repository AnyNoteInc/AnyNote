import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import * as domain from '@repo/domain'

import { PRISMA } from '../../../infra/db/db.providers.js'

export type ListFavoritesInput = { userId: string; workspaceId?: string }
export type AddFavoriteInput = { userId: string; workspaceId: string; pageId: string }
export type RemoveFavoriteInput = { userId: string; pageId: string } // returns { count: number }
export type ReorderFavoritesInput = { userId: string; workspaceId: string; orderedIds: string[] }

@Injectable()
export class FavoriteService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(input: ListFavoritesInput) {
    const rows = await this.prisma.favoritePage.findMany({
      where: {
        userId: input.userId,
        ...(input.workspaceId ? { page: { workspaceId: input.workspaceId } } : {}),
      },
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
    await domain.addFavorite(this.prisma, input.userId, { pageId: input.pageId })
    return { ok: true }
  }

  async remove(input: RemoveFavoriteInput): Promise<{ count: number }> {
    // domain.removeFavorite returns { count } (no assertPageAccess). Engines MCP
    // callers get the deleteMany count; the tRPC wrapper maps this to { pageId } itself.
    return domain.removeFavorite(this.prisma, input.userId, { pageId: input.pageId })
  }

  async reorder(input: ReorderFavoritesInput): Promise<{ ok: true }> {
    return domain.reorderFavorites(this.prisma, input.userId, {
      workspaceId: input.workspaceId,
      orderedIds: input.orderedIds,
    })
  }
}
