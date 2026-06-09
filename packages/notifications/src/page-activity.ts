// Phase 5 — page-activity fan-out for the "Notify me" feature.
//
// `resolvePageActivityRecipients` reads `PageNotificationPreference` rows for a
// page and picks the userIds that opted into the given activity kind. The
// implicit replies/mentions defaults (a user with no row still gets direct
// replies/@mentions) are handled at the comment trigger site — NOT here; this
// helper only resolves the *preference-driven* recipients.
//
// `shouldDedup` collapses bursts: before emitting a page-activity event to a
// recipient, skip if an UNREAD in-app notification with the same
// (userId, type, pageId, actorId) was created within DEDUP_WINDOW_MS.
//
// `notifyPageActivity` ties them together: it iterates the resolved recipients
// and emits via the matching `notify.*` helper, applying the dedup guard —
// EXCEPT for direct mentions/replies, which must never be deduped away.

import type { PrismaClient, NotificationEventType } from '@repo/db'

import { notify } from './helpers.ts'

/** Burst-dedup window: collapse same-key unread events created within 10 min. */
export const DEDUP_WINDOW_MS = 10 * 60 * 1000

/** The page-activity kinds resolvePageActivityRecipients understands. */
export type PageActivityKind = 'comment' | 'database_update' | 'database_important'

type Tx = Pick<PrismaClient, 'pageNotificationPreference' | 'notificationInApp'>

/**
 * Resolve the preference-driven recipients for a page-activity kind.
 *  - `comment`            → users with ALL_COMMENTS or ALL_UPDATES.
 *  - `database_update`    → users with ALL_UPDATES.
 *  - `database_important` → users with ALL_UPDATES or IMPORTANT_UPDATES.
 * Always excludes the actor. Returns distinct userIds.
 */
export async function resolvePageActivityRecipients(
  prisma: Tx,
  opts: { pageId: string; kind: PageActivityKind; actorId?: string | null },
): Promise<string[]> {
  const levels =
    opts.kind === 'comment'
      ? (['ALL_COMMENTS', 'ALL_UPDATES'] as const)
      : opts.kind === 'database_update'
        ? (['ALL_UPDATES'] as const)
        : (['ALL_UPDATES', 'IMPORTANT_UPDATES'] as const)

  const rows = await prisma.pageNotificationPreference.findMany({
    where: { pageId: opts.pageId, level: { in: [...levels] } },
    select: { userId: true },
  })

  const out = new Set<string>()
  for (const r of rows) {
    if (opts.actorId && r.userId === opts.actorId) continue
    out.add(r.userId)
  }
  return [...out]
}

/**
 * True if a recent UNREAD in-app notification with the same
 * (userId, type, payload.pageId, payload.actorId) exists within `windowMs`.
 * Used to suppress burst page-activity events; direct mentions/replies must NOT
 * be routed through this.
 */
export async function shouldDedup(
  prisma: Tx,
  opts: {
    userId: string
    pageId: string
    actorId?: string | null
    type: NotificationEventType
    windowMs?: number
  },
): Promise<boolean> {
  const windowMs = opts.windowMs ?? DEDUP_WINDOW_MS
  const since = new Date(Date.now() - windowMs)
  const existing = await prisma.notificationInApp.findFirst({
    where: {
      userId: opts.userId,
      readAt: null,
      createdAt: { gte: since },
      event: {
        type: opts.type,
        AND: [
          { payload: { path: ['pageId'], equals: opts.pageId } },
          opts.actorId
            ? { payload: { path: ['actorId'], equals: opts.actorId } }
            : {},
        ],
      },
    },
    select: { id: true },
  })
  return existing !== null
}

type PageActivityNotifyKind =
  | 'comment_reply'
  | 'comment'
  | 'database_update'
  | 'database_person_assigned'

type DispatchPayload = {
  workspaceId: string
  pageId: string
  actorId?: string
  actorName: string
  threadId?: string
  commentId?: string
  rowId?: string
  propertyId?: string
  snippet?: string
  label?: string
}

const TYPE_BY_KIND: Record<PageActivityNotifyKind, NotificationEventType> = {
  comment_reply: 'COMMENT_REPLY',
  comment: 'COMMENT_CREATED',
  database_update: 'DATABASE_UPDATE',
  database_person_assigned: 'DATABASE_PERSON_ASSIGNED',
}

// Direct mentions/replies/person-assignments are targeted and MUST never be
// deduped away. Burst-prone broadcast kinds (comment fan-out, database_update)
// go through the dedup guard.
const BYPASS_DEDUP: Record<PageActivityNotifyKind, boolean> = {
  comment_reply: true,
  comment: false,
  database_update: false,
  database_person_assigned: true,
}

/**
 * Emit a page-activity notification to each recipient, applying the burst-dedup
 * guard (except for mention/reply/person-assign kinds, which bypass it). The
 * caller resolves `recipients` (e.g. via resolvePageActivityRecipients) and
 * must already have excluded the actor.
 */
export async function notifyPageActivity(
  prisma: PrismaClient,
  opts: {
    kind: PageActivityNotifyKind
    recipients: string[]
    payload: DispatchPayload
  },
): Promise<void> {
  const type = TYPE_BY_KIND[opts.kind]
  const bypass = BYPASS_DEDUP[opts.kind]
  const p = opts.payload

  for (const userId of opts.recipients) {
    if (p.actorId && userId === p.actorId) continue
    if (!bypass) {
      const skip = await shouldDedup(prisma, {
        userId,
        pageId: p.pageId,
        actorId: p.actorId,
        type,
      })
      if (skip) continue
    }

    switch (opts.kind) {
      case 'comment_reply':
        await notify.commentReply(prisma, {
          userId,
          workspaceId: p.workspaceId,
          pageId: p.pageId,
          threadId: p.threadId ?? '',
          commentId: p.commentId ?? '',
          actorId: p.actorId,
          actorName: p.actorName,
          snippet: p.snippet ?? '',
        })
        break
      case 'comment':
        await notify.commentCreated(prisma, {
          userId,
          workspaceId: p.workspaceId,
          pageId: p.pageId,
          commentId: p.commentId ?? '',
          actorId: p.actorId,
          actorName: p.actorName,
          snippet: p.snippet ?? '',
        })
        break
      case 'database_update':
        await notify.databaseUpdate(prisma, {
          userId,
          workspaceId: p.workspaceId,
          pageId: p.pageId,
          rowId: p.rowId ?? '',
          propertyId: p.propertyId ?? '',
          actorId: p.actorId,
          actorName: p.actorName,
          label: p.label ?? '',
        })
        break
      case 'database_person_assigned':
        await notify.databasePersonAssigned(prisma, {
          userId,
          workspaceId: p.workspaceId,
          pageId: p.pageId,
          rowId: p.rowId ?? '',
          propertyId: p.propertyId ?? '',
          actorId: p.actorId,
          actorName: p.actorName,
          label: p.label ?? '',
        })
        break
    }
  }
}
