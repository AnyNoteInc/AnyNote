import type { PrismaClient } from '@repo/db'

export type ShareRow = {
  shareId: string
  access: string
  linkRole: string
  mode: string
  expiresAt: Date | null
  publishedAt: Date | null
  unpublishedAt: Date | null
  allowIndexing: boolean
  allowCopy: boolean
  publishSubpages: boolean
  analyticsGoogleId: string | null
  analyticsYandexMetricaId: string | null
  passwordHash: string | null
  exposesAt: Date | null
  page: {
    id: string
    type: string
    title: string | null
    icon: string | null
    workspaceId: string
    parentId: string | null
    collectionId: string | null
    archivedAt: Date | null
    deletedAt: Date | null
  }
}

export class ShareAccessRepository {
  private readonly prisma: PrismaClient
  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  async findShareByShareId(shareId: string): Promise<ShareRow | null> {
    return this.prisma.pageShare.findUnique({
      where: { shareId },
      select: {
        shareId: true,
        access: true,
        linkRole: true,
        mode: true,
        expiresAt: true,
        publishedAt: true,
        unpublishedAt: true,
        allowIndexing: true,
        allowCopy: true,
        publishSubpages: true,
        analyticsGoogleId: true,
        analyticsYandexMetricaId: true,
        passwordHash: true,
        exposesAt: true,
        page: {
          select: {
            id: true,
            type: true,
            title: true,
            icon: true,
            workspaceId: true,
            parentId: true,
            collectionId: true,
            archivedAt: true,
            deletedAt: true,
          },
        },
      },
    }) as Promise<ShareRow | null>
  }

  // Walks parentId from childId up toward rootId; returns the path of pages
  // (child-first) or null if rootId is never reached or a cycle is detected.
  async findPathToRoot(
    childId: string,
    rootId: string,
  ): Promise<Array<{
    id: string
    parentId: string | null
    collectionId: string | null
    archivedAt: Date | null
    deletedAt: Date | null
    collectionKind: string | null
    collectionOwnerId: string | null
  }> | null> {
    const path: Array<{
      id: string
      parentId: string | null
      collectionId: string | null
      archivedAt: Date | null
      deletedAt: Date | null
      collectionKind: string | null
      collectionOwnerId: string | null
    }> = []
    const seen = new Set<string>()
    let current: string | null = childId
    while (current) {
      if (seen.has(current)) return null
      seen.add(current)
      const row: {
        id: string
        parentId: string | null
        collectionId: string | null
        archivedAt: Date | null
        deletedAt: Date | null
        collection: { kind: string; ownerId: string | null } | null
      } | null = await this.prisma.page.findUnique({
        where: { id: current },
        select: {
          id: true,
          parentId: true,
          collectionId: true,
          archivedAt: true,
          deletedAt: true,
          collection: { select: { kind: true, ownerId: true } },
        },
      })
      if (!row) return null
      path.push({
        id: row.id,
        parentId: row.parentId,
        collectionId: row.collectionId,
        archivedAt: row.archivedAt,
        deletedAt: row.deletedAt,
        collectionKind: row.collection?.kind ?? null,
        collectionOwnerId: row.collection?.ownerId ?? null,
      })
      if (row.id === rootId) return path
      current = row.parentId
    }
    return null
  }

  async findPublicPageById(id: string): Promise<{
    id: string
    type: string
    title: string | null
    icon: string | null
    workspaceId: string
  } | null> {
    return this.prisma.page.findUnique({
      where: { id },
      select: { id: true, type: true, title: true, icon: true, workspaceId: true },
    })
  }
}
