import { notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { CopyTreeInput, CopyTreeResult } from '../dto/share-copy.dto.ts'
import type { ShareCopyRepository, SourcePageRow } from '../repositories/share-copy.repository.ts'

/**
 * Deep-copies a public page (and, optionally, its visible subtree) into a
 * workspace/collection the actor belongs to — Notion's "Duplicate as template".
 *
 * It copies ONLY renderable state: `content` JSON, the authoritative
 * `contentYjs` bytes, `icon`, `type`, and `title`. It never copies comments,
 * share grants, files, or any workspace-only metadata. Each copy records its
 * provenance (`copiedFromShareId` / `copiedFromPageId` / `copiedAt`).
 *
 * The subtree walk re-fetches live content (no stale snapshots) and skips
 * archived, deleted, and other-user PERSONAL pages — so a copy never leaks a
 * page the visitor could not have reached.
 */
export class PublicShareCopyService {
  private readonly repo: ShareCopyRepository
  private readonly uow: UnitOfWork
  constructor(repo: ShareCopyRepository, uow: UnitOfWork) {
    this.repo = repo
    this.uow = uow
  }

  async copyTree(input: CopyTreeInput): Promise<CopyTreeResult> {
    const root = await this.repo.findSourcePage(input.rootPageId)
    if (!root) throw notFound('Страница недоступна для копирования')

    const now = new Date()

    return this.uow.transaction(async () => {
      // old page id -> new copy id, so we can re-parent descendants.
      const idMap = new Map<string, string>()

      // The copied root becomes a top-level page in the target collection.
      const rootCopy = await this.copyOne(input, root, null, now)
      idMap.set(root.id, rootCopy.id)

      if (input.includeSubtree) {
        let frontier = [root.id]
        while (frontier.length > 0) {
          const children = await this.repo.findCopyableChildren(frontier, input.actorUserId)
          const nextFrontier: string[] = []
          for (const child of children) {
            const newParentId = child.parentId ? (idMap.get(child.parentId) ?? null) : null
            // A child whose parent was skipped has no mapped parent — drop it
            // so we never re-attach an orphan to the target root.
            if (child.parentId && newParentId === null) continue
            const copy = await this.copyOne(input, child, newParentId, now)
            idMap.set(child.id, copy.id)
            nextFrontier.push(child.id)
          }
          frontier = nextFrontier
        }
      }

      return { rootPageId: rootCopy.id }
    })
  }

  private async copyOne(
    input: CopyTreeInput,
    source: SourcePageRow,
    targetParentId: string | null,
    copiedAt: Date,
  ): Promise<{ id: string }> {
    return this.repo.createCopiedPage(input.actorUserId, {
      workspaceId: input.targetWorkspaceId,
      collectionId: input.targetCollectionId,
      parentId: targetParentId,
      title: source.title,
      icon: source.icon,
      type: source.type,
      content: source.content,
      contentYjs: source.contentYjs,
      copiedFromShareId: input.fromShareId,
      copiedFromPageId: source.id,
      copiedAt,
    })
  }
}
