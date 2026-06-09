# Notion-parity Phase 5 — Notifications, document history, Notify-me, database reminders

Status: approved design (2026-06-09). Roadmap source: `cl5.md` (prompts 5.1–5.4).
Builds on the existing notification system (`@repo/notifications`: NotificationEvent/
InApp/Delivery/Preference + emit() + the notifier cron), the reminder system
(`Reminder` + `rebuildDeliveries` time-gated delivery), and the Yjs persistence hook.

## Goal

Add: page revision history with restore, Notion-style `Notify me` page/database
preferences, grouped/deduped Inbox notifications, mentions/replies/comments/person-
property notification semantics, and database `Date`-property reminders — all reusing
the existing notification+reminder pipeline and respecting page/database access.

## Notion alignment guardrails

- Version history is Notion-like, not raw audit logging: coarse snapshots during active
  editing (~10 min cadence) + one after editing settles; NOT per-keystroke. Ignore
  cursor/presence-only Yjs updates.
- Retention maps to existing AnyNote plan tiers (a configurable window 7/30/90/unlimited),
  NOT hard-coded Notion plan names in the UI. Pruning happens in a job, not in read APIs.
- History list/preview/restore require EDIT-level page access. Restore creates a new
  current version + keeps prior snapshots restorable within retention. Never expose a
  snapshot after the user loses access.
- User-facing naming is `Notify me` / notification preference, never "subscribe".
- Regular TEXT pages: `All comments`, `Replies and @mentions`. Database pages also:
  `All updates`, `Important updates`. `ALL_UPDATES` for TEXT content edits is an AnyNote
  extension only if needed — not claimed as Notion parity.
- @mentions + comment replies notify directly; they do NOT auto-subscribe the user to all
  future page updates.
- Database reminders are tied to a `Date` property value and are SELF-TARGETED (Notion
  doesn't let you assign a database date reminder to someone else). Calendar visibility is
  not a notification subscription.
- Preserve the existing notification pipeline + ACL: add event kinds/preferences without
  bypassing delivery, read/archive, or access checks.

## Data model (one migration)

### `PageRevision` (new)

```prisma
enum PageRevisionAction { EDIT TITLE_CHANGE MOVE ARCHIVE RESTORE PUBLISH }

model PageRevision {
  id         String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId     String             @map("page_id") @db.Uuid
  actorId    String?            @map("actor_id") @db.Uuid
  action     PageRevisionAction
  content    Json?              // Tiptap JSON snapshot (TEXT) — nullable
  contentYjs Bytes?             @map("content_yjs") // Yjs state snapshot — nullable
  metadata   Json?              // { title, icon, type, parentId, workspaceId, summary? }
  createdAt  DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)

  page  Page  @relation(fields: [pageId], references: [id], onDelete: Cascade)
  actor User? @relation("PageRevisionActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([pageId, createdAt(sort: Desc)])
  @@map("page_revisions")
}
```

### `PageNotificationPreference` (new — `Notify me`)

```prisma
enum PageNotificationLevel {
  ALL_COMMENTS
  REPLIES_AND_MENTIONS
  ALL_UPDATES          // database pages
  IMPORTANT_UPDATES    // database pages
}

model PageNotificationPreference {
  id        String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String                @map("user_id") @db.Uuid
  pageId    String                @map("page_id") @db.Uuid
  level     PageNotificationLevel
  createdAt DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime              @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  page Page @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([userId, pageId])
  @@index([pageId])
  @@map("page_notification_preferences")
}
```

No preference row → implicit default: replies + @mentions notify (the user is NOT
opted into all page updates).

### `DatabaseDateReminder` (new — self-targeted)

```prisma
model DatabaseDateReminder {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  propertyId    String   @map("property_id") @db.Uuid  // a DATE property
  rowId         String   @map("row_id") @db.Uuid
  pageId        String   @map("page_id") @db.Uuid      // the DATABASE page
  userId        String   @map("user_id") @db.Uuid      // self-target (Notion parity)
  offsetMinutes Int      @default(0) @map("offset_minutes") // advance notice before the date
  timezone      String?
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  property DatabaseProperty @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  row      DatabaseRow      @relation(fields: [rowId], references: [id], onDelete: Cascade)
  user     User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([propertyId, rowId, userId])
  @@index([rowId])
  @@map("database_date_reminders")
}
```

### New notification event types (enum + catalog)

`PAGE_REVISION_RESTORED` (optional), `COMMENT_REPLY`, `DATABASE_UPDATE`,
`DATABASE_PERSON_ASSIGNED`, `DATABASE_DATE_REMINDER`. Each gets an `EVENT_CATALOG`
descriptor (category COLLABORATION, defaultChannels `['IN_APP','EMAIL']`, locked
`['IN_APP']`). (Reuse `REMINDER_DUE` shape for the database date reminder.)

### Plan retention feature

Add `pageHistoryDays: number | null` to `PlanFeatures` (null = unlimited), parsed from
`Plan.features` JSON (e.g. `"pageHistory:30"`), mirroring `publicSitesEnabled`. The
engines `plan-features.service.ts` reads it for the prune cron.

## Document history (5.1 + 5.2)

`RevisionCaptureService` (`@repo/domain`, new module `page-history`):
- `captureContentRevision({pageId, actorId, content, contentYjs, metadata})` — called
  from the Yjs `storePageDocument` hook (`apps/yjs`). **Throttle**: skip if the most
  recent revision for this page is younger than `HISTORY_MIN_INTERVAL_MS` (~10 min) AND
  same actor — giving the Notion "every ~10 min during active editing + one after it
  settles" cadence. Ignore presence-only updates (the hook only fires on real content
  saves, so this is mostly automatic). Action = EDIT.
- `captureStructuralRevision({pageId, actorId, action, metadata})` — called from the
  domain page service on rename (TITLE_CHANGE), move (MOVE), archive (ARCHIVE), restore
  (RESTORE). Always captures (these are discrete, not bursty).
- The `apps/yjs` service has no `@repo/domain` access (separate process); the simplest
  wiring: `apps/yjs` writes the revision directly via its Prisma client in
  `storePageDocument` (a focused `capturePageRevisionTx` in `apps/yjs/src/persistence.ts`
  reusing the same throttle rule), AND the domain page service captures structural ones.
  (Document the two capture sites.)

Retention: a **prune cron** in `apps/engines` (`apps/engines/src/apps/history/`) runs on
a schedule (e.g. `HISTORY_PRUNE_CRON` default daily), and for each workspace deletes
`PageRevision` rows older than the workspace's `pageHistoryDays` (skip when unlimited).
No ad-hoc deletes in read APIs.

tRPC `page.history` (or extend `page` router): `listRevisions({pageId})` (grouped/
sortable; edit-level access), `getRevisionPreview({pageId, revisionId})` (readonly
content; edit-level), `restoreRevision({pageId, revisionId})` (edit-level; writes the
revision's content back to the page via the page service AND records a new RESTORE
revision — never erases history; conflict if the page is deleted). Never return snapshot
content after the user loses access.

UI: a `DocumentHistoryPanel` mirroring the comments sidebar (a `PageHistoryContext` +
`<HistorySidebar>` in the page layout flex row + a toolbar "История" entry, OR a
`page-actions-menu` item). Revisions grouped by date; actor/action/time + a compact
best-effort change summary; readonly preview of a selected revision; a restore button
with confirmation. States: no history; unavailable by plan/retention; revision no longer
restorable; restore conflict (page deleted/archived). Side panel, compact typography.

## Notify me + Inbox (5.3)

`PageNotificationPreference` storage + tRPC `setPageNotificationPreference`,
`clearPageNotificationPreference`, `getPageNotificationPreference` (all require page read
access). User-facing naming `Notify me`.

Notification mapping (new helpers in `@repo/notifications` + the trigger sites):
- mention → `PAGE_MENTION` (exists), comment reply → `COMMENT_REPLY` (new),
  all_comments → notify users with `ALL_COMMENTS`/`ALL_UPDATES` page prefs on any comment,
  database_all_updates → `DATABASE_UPDATE` for db comments + property changes,
  database_important_updates → `DATABASE_UPDATE` filtered to status/assignee/due-date
  changes, reminder → existing, person-property assignment → `DATABASE_PERSON_ASSIGNED`.
- A `notifyPageActivity(prisma, {pageId, actorId, kind, ...})` helper resolves recipients
  from `PageNotificationPreference` (+ the implicit replies/mentions defaults) and emits.
- Mentions/replies notify directly and DO NOT opt the user into all future updates.
- Adding a user to a database PERSON property emits `DATABASE_PERSON_ASSIGNED` to that
  user (subject to the db page's notification setting + access).

Dedup + grouping + rate limit:
- **Dedup window**: a guard in the new helpers — before emitting a `DATABASE_UPDATE`/
  page-activity event for `(pageId, actorId, type)`, skip if an UNREAD same-key in-app
  notification was created within `DEDUP_WINDOW_MS` (collapses edit bursts). (Direct
  mentions/replies are NOT deduped away.)
- **Grouping**: the Inbox view-model groups in-app items by page + comment thread (storage
  stays per-event; the `notification.list` view-model returns grouped buckets, or the UI
  groups by `event.payload.pageId`/`threadId`).
- **Active-viewer suppression**: if a presence/active-page signal exists, skip notifying a
  user currently viewing the trigger page. If no reliable presence signal exists,
  documented as a limitation.

UI: a page-action "Уведомлять меня" menu — TEXT page options (`Все комментарии`,
`Ответы и упоминания`), database page options (`Все обновления`, `Важные обновления`,
`Ответы и упоминания`); the Inbox popover/list groups by page/thread; per-item action to
change the preference where the current UI supports it.

## Database date reminders (5.4)

`DatabaseDateReminder` config (self-targeted). On create/update (and when the DATE cell
value changes), build `NotificationDelivery` rows via the existing `rebuildDeliveries`
path: `nextAttemptAt = <date cell value> - offsetMinutes`; channel set from the user's
prefs; event type `DATABASE_DATE_REMINDER`. The notifier cron fires it into the Inbox +
configured channels. **Access re-check at fire time**: the dispatcher validates the
viewer still has access to the row (reuse the cl4C row-access resolver / a validity check
like `isReminderEventStillValid`) so a user who lost access gets no content-bearing
reminder. Rescheduled/cleared when the date cell changes or the reminder is removed.
Self-targeted only — cannot target another user (Notion parity). tRPC:
`setDatabaseDateReminder`, `clearDatabaseDateReminder`, `getDatabaseDateReminder`
(per propertyId+rowId). UI: a reminder editor on the date cell + a reminder-status
indicator in the date cell/picker. Calendar visibility is NOT a subscription.

## Testing

trpc/domain:
- a meaningful content/title/move/archive change creates a revision; no revision for a
  no-op or a sub-10-min same-actor edit (throttle); restore reverts content/title + writes
  a RESTORE revision; retention prune deletes only expired revisions; unauthorized user
  cannot list/preview/restore.
- mention → Inbox notification, no hidden-content leak; comment reply notifies participants;
  `All comments` pref gets comment notifications; clearing a pref stops pref-driven
  notifications but not direct mentions/replies; database `All updates` gets property-change
  notifications; `Important updates` gets status/assignee/due-date but not unrelated changes;
  actor doesn't notify self; permission loss before delivery prevents a content-bearing
  notification; dedup collapses a burst.
- database date reminder scheduled → notification generated → fires through Inbox; ACL
  respected (no content-bearing reminder to a user without row access); cannot target
  someone else.

Playwright (focused): open История, preview + restore a revision; set a Notify-me level;
set a date-cell reminder shows its status.

## Checks (cl5 gate)

- `pnpm --filter @repo/trpc test`
- `pnpm --filter @repo/domain test`
- `pnpm --filter web lint`
- `pnpm check-types`
- `pnpm check-architecture`
- focused Playwright history/notify spec
- migration validated on a fresh scratch DB (zero drift), never the shared dev DB.

## Done criteria

Useful Notion-like page history with restore (coarse cadence, plan-bounded retention,
edit-gated); intentional `Notify me` page/database preferences (not misleading
"subscription"); grouped/deduped Inbox; mentions/replies/comments/person-property and
database date reminders follow Notion notification semantics and never leak content past
access loss. The existing notification/reminder pipeline is reused, not replaced.
