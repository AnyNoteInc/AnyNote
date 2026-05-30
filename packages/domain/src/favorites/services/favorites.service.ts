import { notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { WorkspaceService } from '../../workspace/index.ts'
import type { AddFavoriteInput, FavoritePageDto, RemoveFavoriteInput, ReorderFavoritesInput } from '../dto/favorites.dto.ts'
import type { FavoriteRepository } from '../repositories/favorites.repository.ts'

export class FavoriteService {
  constructor(
    private readonly repo: FavoriteRepository,
    private readonly uow: UnitOfWork,
    private readonly workspace: WorkspaceService,
  ) {}

  async add(actorUserId: string, input: AddFavoriteInput): Promise<FavoritePageDto> {
    const page = await this.repo.findAccessiblePage(actorUserId, input.pageId)
    if (!page) throw notFound('Страница не найдена')
    return this.uow.transaction(async () => {
      const max = await this.repo.maxFavoritePosition(actorUserId)
      return this.repo.upsertFavorite(actorUserId, input.pageId, (max ?? -1) + 1)
    })
  }

  async remove(actorUserId: string, input: RemoveFavoriteInput): Promise<{ count: number }> {
    // No page-access check: allow un-favoriting a page you've lost access to.
    return this.repo.removeFavorite(actorUserId, input.pageId)
  }

  async reorder(actorUserId: string, input: ReorderFavoritesInput): Promise<{ ok: true }> {
    await this.workspace.assertMembership(actorUserId, input.workspaceId)
    await this.uow.transaction(() =>
      this.repo.reorderFavorites(actorUserId, input.workspaceId, input.orderedIds),
    )
    return { ok: true }
  }
}
