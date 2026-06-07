import { CollectionKind } from '@repo/db'
import type { Prisma } from '@repo/db'

/**
 * Mirror of the web app's buildPageVisibilityWhere (@repo/domain). A page is visible to
 * `userId` when it lives in the workspace TEAM collection, OR has a NULL collection
 * (transitional), OR is in the user's own PERSONAL collection, OR is explicitly shared
 * to the user via PageShareUser.
 *
 * Replicated inline here (rather than imported) because engines must not depend on the
 * web tRPC/domain layer. Archive/trash are an ORTHOGONAL filter applied by callers
 * (archivedAt / deletedAt), NOT part of this access predicate.
 */
export function pageVisibilityWhere(userId: string): Prisma.PageWhereInput {
  return {
    OR: [
      { collection: { kind: CollectionKind.TEAM } },
      { collectionId: null },
      { collection: { kind: CollectionKind.PERSONAL, ownerId: userId } },
      { share: { users: { some: { userId } } } },
    ],
  }
}
