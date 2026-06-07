import { forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { CollectionRepository } from '../repositories/collections.repository.ts'
import type {
  CollectionDto,
  ReorderCollectionsInput,
  UpdateCollectionInput,
} from '../dto/collections.dto.ts'

export class CollectionService {
  private readonly repo: CollectionRepository
  private readonly uow: UnitOfWork
  constructor(repo: CollectionRepository, uow: UnitOfWork) {
    this.repo = repo
    this.uow = uow
  }

  /** Idempotent: ensure the workspace has a TEAM collection + a PERSONAL collection per member. */
  async ensureWorkspaceCollections(workspaceId: string): Promise<void> {
    await this.uow.transaction(async () => {
      const team = await this.repo.findTeamCollection(workspaceId)
      if (!team) await this.repo.createTeamCollection(workspaceId)
      const members = await this.repo.listMembers(workspaceId)
      for (const m of members) {
        const personal = await this.repo.findPersonalCollection(workspaceId, m.userId)
        if (!personal) await this.repo.createPersonalCollection(workspaceId, m.userId)
      }
    })
  }

  /** Idempotent: ensure a single member has a PERSONAL collection in this workspace. */
  async ensurePersonalCollection(workspaceId: string, userId: string): Promise<{ id: string }> {
    return this.uow.transaction(async () => {
      const existing = await this.repo.findPersonalCollection(workspaceId, userId)
      if (existing) return existing
      return this.repo.createPersonalCollection(workspaceId, userId)
    })
  }

  async listForUser(workspaceId: string, userId: string): Promise<CollectionDto[]> {
    const member = await this.repo.findMembership(userId, workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')
    const cols = await this.repo.listForUser(workspaceId, userId)
    const order = await this.repo.getCollectionOrder(userId)
    if (!order) return cols
    const rank = new Map(order.map((id, i) => [id, i]))
    return [...cols].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }

  async update(actorUserId: string, input: UpdateCollectionInput): Promise<{ id: string }> {
    const col = await this.repo.getCollectionWorkspace(input.collectionId)
    if (!col || col.workspaceId !== input.workspaceId) throw notFound('Коллекция не найдена')
    const member = await this.repo.findMembership(actorUserId, input.workspaceId)
    if (member?.role !== 'OWNER' && member?.role !== 'ADMIN') throw forbidden('Недостаточно прав')
    return this.uow.transaction(() => this.repo.updateCollectionTx(input))
  }

  async reorder(actorUserId: string, input: ReorderCollectionsInput): Promise<{ count: number }> {
    const member = await this.repo.findMembership(actorUserId, input.workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')
    await this.repo.setCollectionOrder(actorUserId, input.orderedIds)
    return { count: input.orderedIds.length }
  }
}
