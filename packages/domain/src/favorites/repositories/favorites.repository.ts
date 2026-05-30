import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { FavoritePageDto } from '../dto/favorites.dto.ts'

export class FavoriteRepository {
  constructor(private readonly uow: UnitOfWork) {}

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

  async maxFavoritePosition(userId: string): Promise<number | null> {
    const result = await this.uow.client().favoritePage.aggregate({
      where: { userId },
      _max: { position: true },
    })
    return result._max.position ?? null
  }

  async upsertFavorite(
    userId: string,
    pageId: string,
    position: number,
  ): Promise<FavoritePageDto> {
    const row = await this.uow.client().favoritePage.upsert({
      where: { userId_pageId: { userId, pageId } },
      create: { userId, pageId, position },
      update: {},
    })
    return { userId: row.userId, pageId: row.pageId, position: row.position }
  }

  async removeFavorite(userId: string, pageId: string): Promise<{ count: number }> {
    return this.uow.client().favoritePage.deleteMany({ where: { userId, pageId } })
  }

  async reorderFavorites(
    userId: string,
    workspaceId: string,
    orderedIds: string[],
  ): Promise<void> {
    for (const [index, pageId] of orderedIds.entries()) {
      await this.uow.client().favoritePage.updateMany({
        where: { userId, pageId, page: { workspaceId } },
        data: { position: index },
      })
    }
  }
}
