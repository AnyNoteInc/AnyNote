import type { PrismaClient } from '@repo/db'
import { DatabasePropertyType } from '@repo/db'
import { notifyPageActivity, resolvePageActivityRecipients } from '@repo/notifications'

import { domain as domainSvc } from '../domain'

// Property types whose change is "important" (notifies IMPORTANT_UPDATES-pref
// users in addition to ALL_UPDATES): status, person/assignee, and due-date.
const IMPORTANT_TYPES = new Set<DatabasePropertyType>([
  DatabasePropertyType.STATUS,
  DatabasePropertyType.PERSON,
  DatabasePropertyType.DATE,
])

type ActorName = { firstName?: string | null; lastName?: string | null }

function actorLabel(u: ActorName | null): string {
  if (!u) return 'Кто-то'
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
  return name || 'Кто-то'
}

/**
 * Fan out database-update notifications after a successful cell write (Phase 5).
 * Side-effect only — never throws into the caller (the cell write already
 * succeeded). Recipients are filtered by ROW ACCESS (a user who can't view the
 * row gets no content-bearing notification); the actor never self-notifies.
 *
 *  - assigning a user to a PERSON property → DATABASE_PERSON_ASSIGNED to the
 *    assignee (if they can view the row);
 *  - any property change → DATABASE_UPDATE to ALL_UPDATES-pref users;
 *  - a STATUS / PERSON / DATE change → also to IMPORTANT_UPDATES-pref users.
 */
export async function notifyDatabaseCellUpdate(
  prisma: PrismaClient,
  args: {
    actorId: string
    workspaceId: string
    pageId: string
    rowId: string
    propertyId: string
    propertyType: DatabasePropertyType
    propertyName: string
    /** The newly-assigned userId for a PERSON write (else null). */
    assigneeId: string | null
  },
): Promise<void> {
  try {
    const actor = await prisma.user.findUnique({
      where: { id: args.actorId },
      select: { firstName: true, lastName: true },
    })
    const actorName = actorLabel(actor)
    const important = IMPORTANT_TYPES.has(args.propertyType)

    // Reuse the cl4C row-access resolver: a recipient who can't view this row
    // must never receive a content-bearing notification.
    const canView = (userId: string) =>
      domainSvc.database.canUserViewRow(userId, args.pageId, args.rowId)

    // 1) PERSON assignment → notify the assignee directly (bypasses dedup).
    if (
      args.propertyType === DatabasePropertyType.PERSON &&
      args.assigneeId &&
      args.assigneeId !== args.actorId &&
      (await canView(args.assigneeId))
    ) {
      await notifyPageActivity(prisma, {
        kind: 'database_person_assigned',
        recipients: [args.assigneeId],
        payload: {
          workspaceId: args.workspaceId,
          pageId: args.pageId,
          rowId: args.rowId,
          propertyId: args.propertyId,
          actorId: args.actorId,
          actorName,
          label: args.propertyName,
        },
      })
    }

    // 2) DATABASE_UPDATE fan-out: ALL_UPDATES users for ANY change, plus
    //    IMPORTANT_UPDATES users only for an important (STATUS/PERSON/DATE)
    //    change. `database_important` resolves both levels.
    const prefRecipients = await resolvePageActivityRecipients(prisma, {
      pageId: args.pageId,
      kind: important ? 'database_important' : 'database_update',
      actorId: args.actorId,
    })
    // Don't double-notify a just-assigned person (covered by step 1).
    const filtered = prefRecipients.filter((u) => u !== args.assigneeId)
    const viewable: string[] = []
    for (const userId of filtered) {
      if (await canView(userId)) viewable.push(userId)
    }
    await notifyPageActivity(prisma, {
      kind: 'database_update',
      recipients: viewable,
      payload: {
        workspaceId: args.workspaceId,
        pageId: args.pageId,
        rowId: args.rowId,
        propertyId: args.propertyId,
        actorId: args.actorId,
        actorName,
        label: args.propertyName,
      },
    })
  } catch (err) {
    console.error('[database] notification fan-out failed', err)
  }
}
