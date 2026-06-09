// Pure Inbox grouping: collapse consecutive in-app notifications that share the
// same page (and comment thread) into one bucket so a burst of activity on a
// page renders under a single page header. Storage stays per-event — this is a
// view-model transform only.

type EventLike = {
  payload?: unknown
  resourceUrl?: string | null
}

export type InAppItemLike = {
  id: string
  event: EventLike
}

export type NotificationGroup<T extends InAppItemLike> = {
  /** Stable bucket key (pageId[:threadId], or the first item id when ungrouped). */
  key: string
  /** The page these notifications belong to, or null for non-page events. */
  pageId: string | null
  /** The comment thread, when every item in the bucket shares one. */
  threadId: string | null
  items: T[]
}

function readString(payload: unknown, field: string): string | null {
  if (payload && typeof payload === 'object') {
    const v = (payload as Record<string, unknown>)[field]
    if (typeof v === 'string' && v) return v
  }
  return null
}

/**
 * Group an already-ordered (newest-first) list of in-app items into buckets,
 * merging only *consecutive* items that share a pageId (and threadId when
 * present). Items without a pageId become singleton buckets, preserving order.
 */
export function groupNotifications<T extends InAppItemLike>(items: T[]): NotificationGroup<T>[] {
  const groups: NotificationGroup<T>[] = []

  for (const item of items) {
    const pageId = readString(item.event.payload, 'pageId')
    const threadId = readString(item.event.payload, 'threadId')

    const last = groups[groups.length - 1]
    const mergeable =
      pageId !== null &&
      last !== undefined &&
      last.pageId === pageId &&
      // Merge by thread when both have one; a page-level (no-thread) item also
      // joins the running page bucket.
      (threadId === null || last.threadId === null || last.threadId === threadId)

    if (mergeable && last) {
      last.items.push(item)
      // Once a bucket carries a concrete thread, keep it; otherwise adopt this
      // item's thread so a later same-thread item still merges.
      if (last.threadId === null && threadId !== null) last.threadId = threadId
    } else {
      groups.push({
        key: pageId ? `${pageId}${threadId ? `:${threadId}` : ''}` : item.id,
        pageId,
        threadId,
        items: [item],
      })
    }
  }

  return groups
}
