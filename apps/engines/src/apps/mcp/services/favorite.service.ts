import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { DOMAIN } from '../../../infra/domain/domain.providers.js'

export type ListFavoritesInput = { userId: string; workspaceId?: string }
export type AddFavoriteInput = { userId: string; workspaceId: string; pageId: string }
export type RemoveFavoriteInput = { userId: string; pageId: string } // returns { count: number }
export type ReorderFavoritesInput = { userId: string; workspaceId: string; orderedIds: string[] }

@Injectable()
export class FavoriteService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(DOMAIN) private readonly domain: Domain,
  ) {}

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
    await this.domain.favorites.add(input.userId, { pageId: input.pageId })
    return { ok: true }
  }

  async remove(input: RemoveFavoriteInput): Promise<{ count: number }> {
    // domain.favorites.remove returns { count } (no assertPageAccess). Engines MCP
    // callers get the deleteMany count; the tRPC wrapper maps this to { pageId } itself.
    return this.domain.favorites.remove(input.userId, { pageId: input.pageId })
  }

  async reorder(input: ReorderFavoritesInput): Promise<{ ok: true }> {
    return this.domain.favorites.reorder(input.userId, {
      workspaceId: input.workspaceId,
      orderedIds: input.orderedIds,
    })
  }
}
