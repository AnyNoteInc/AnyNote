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

/**
 * Mirror of @repo/domain `excludeDatabaseRowPages`. Hide "database item" pages
 * (real Pages parented to a DATABASE page) from MCP page listings — they belong
 * inside the database table view, not the generic page tree.
 *
 * Replicated inline (rather than imported) because engines must not depend on the
 * web tRPC/domain layer. Pages with NO parent (parentId null) must NOT be
 * excluded — the explicit `OR` with `parentId: null` keeps root pages (and the
 * DATABASE pages themselves) visible.
 */
export function excludeDatabaseRowPages(): Prisma.PageWhereInput {
  return {
    OR: [{ parentId: null }, { parent: { is: { type: { not: 'DATABASE' } } } }],
  }
}
