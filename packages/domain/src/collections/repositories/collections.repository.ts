import { CollectionKind } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { CollectionDto, UpdateCollectionInput } from '../dto/collections.dto.ts'

export class CollectionRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  async findTeamCollection(workspaceId: string): Promise<{ id: string } | null> {
    return this.uow.client().collection.findFirst({
      where: { workspaceId, kind: CollectionKind.TEAM, ownerId: null },
      select: { id: true },
    })
  }

  async findPersonalCollection(
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string } | null> {
    return this.uow.client().collection.findFirst({
      where: { workspaceId, kind: CollectionKind.PERSONAL, ownerId: userId },
      select: { id: true },
    })
  }

  async createTeamCollection(workspaceId: string): Promise<{ id: string }> {
    return this.uow.client().collection.create({
      data: { workspaceId, kind: CollectionKind.TEAM, title: 'Общее', position: 0 },
      select: { id: true },
    })
  }

  async createPersonalCollection(workspaceId: string, userId: string): Promise<{ id: string }> {
    return this.uow.client().collection.create({
      data: {
        workspaceId,
        kind: CollectionKind.PERSONAL,
        ownerId: userId,
        title: 'Личное',
        position: 0,
      },
      select: { id: true },
    })
  }

  async listMembers(workspaceId: string): Promise<{ userId: string }[]> {
    return this.uow.client().workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true },
    })
  }

  async listForUser(workspaceId: string, userId: string): Promise<CollectionDto[]> {
    return this.uow.client().collection.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        OR: [
          { kind: CollectionKind.TEAM, ownerId: null },
          { kind: CollectionKind.PERSONAL, ownerId: userId },
        ],
      },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        workspaceId: true,
        kind: true,
        title: true,
        icon: true,
        color: true,
        ownerId: true,
        homePageId: true,
        position: true,
      },
    })
  }

  async findMembership(userId: string, workspaceId: string): Promise<{ role: string } | null> {
    return this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
  }

  async updateCollectionTx(input: UpdateCollectionInput): Promise<{ id: string }> {
    return this.uow.client().collection.update({
      where: { id: input.collectionId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
      select: { id: true },
    })
  }

  async getCollectionWorkspace(
    collectionId: string,
  ): Promise<{ workspaceId: string; kind: CollectionKind; ownerId: string | null } | null> {
    return this.uow.client().collection.findUnique({
      where: { id: collectionId },
      select: { workspaceId: true, kind: true, ownerId: true },
    })
  }

  async getCollectionOrder(userId: string): Promise<string[] | null> {
    const pref = await this.uow.client().userPreference.findUnique({
      where: { userId },
      select: { collectionOrder: true },
    })
    return (pref?.collectionOrder as string[] | null) ?? null
  }

  async setCollectionOrder(userId: string, orderedIds: string[]): Promise<void> {
    await this.uow.client().userPreference.upsert({
      where: { userId },
      create: { userId, collectionOrder: orderedIds },
      update: { collectionOrder: orderedIds },
    })
  }
}
