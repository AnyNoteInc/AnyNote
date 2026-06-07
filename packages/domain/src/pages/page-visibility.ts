import { CollectionKind } from '@repo/db'
import type { Prisma } from '@repo/db'

/**
 * Single source of truth for "can this user see this page" as a Prisma where-fragment.
 * Reused by page tree, search, recents, export, and engines MCP page queries.
 *
 * A page is visible to `userId` when it lives in the workspace TEAM collection,
 * OR in the user's own PERSONAL collection, OR an explicit PageShareUser grant exists.
 * Pages with a NULL collection (transitional / template-backing) are treated as TEAM-visible.
 *
 * Archive/trash are an ORTHOGONAL filter applied by callers (archivedAt / deletedAt),
 * NOT part of this access predicate.
 */
export function buildPageVisibilityWhere(userId: string): Prisma.PageWhereInput {
  return {
    OR: [
      { collection: { kind: CollectionKind.TEAM } },
      { collectionId: null },
      { collection: { kind: CollectionKind.PERSONAL, ownerId: userId } },
      { share: { users: { some: { userId } } } },
    ],
  }
}
