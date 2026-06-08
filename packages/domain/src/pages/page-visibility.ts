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

/**
 * Hide "database item" pages from the normal page tree / search / MCP listings.
 *
 * Database rows are real Pages parented to a DATABASE page; they should appear
 * inside the database table view, never in the generic page tree. This predicate
 * excludes any page whose parent is a DATABASE page.
 *
 * CRITICAL (root-page bug): pages with NO parent (parentId null) must NOT be
 * excluded — `{ parent: { is: { type: { not: 'DATABASE' } } } }` alone would drop
 * every root page (the relation filter is false when there is no parent). The
 * explicit `OR` with `parentId: null` keeps roots (and DATABASE pages themselves,
 * which are root-level) visible.
 */
export function excludeDatabaseRowPages(): Prisma.PageWhereInput {
  return {
    OR: [{ parentId: null }, { parent: { is: { type: { not: 'DATABASE' } } } }],
  }
}
