# Notion-parity Phase 5 — Notifications, History, Notify-me, Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add page revision history with restore, Notion-style Notify-me page/database preferences, grouped/deduped Inbox notifications, and database date reminders — reusing the existing notification + reminder pipeline.

**Architecture:** New tables (PageRevision, PageNotificationPreference, DatabaseDateReminder) + new notification event types. Revisions captured from the Yjs save hook (throttled) + the domain page service (structural); pruned by an apps/engines cron bounded by a `pageHistoryDays` plan feature. Notify-me preferences drive new `@repo/notifications` helpers with a burst-dedup guard; the Inbox view-model groups by page/thread. Database date reminders reuse `rebuildDeliveries` (self-targeted, access-rechecked at fire).

**Tech Stack:** Prisma 7, tRPC v11, Zod, inversify 8, Hocuspocus (apps/yjs), NestJS cron (apps/engines), `@repo/notifications`, Next.js 16, MUI v6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-09-notion-parity-phase-5-notifications-history-design.md`

**Reference patterns (study first):** `@repo/notifications` (`emit.ts`, `catalog.ts`, `helpers.ts`, `resolve-preferences.ts`, `reminders.ts` `rebuildDeliveries`, `worker/dispatcher.ts` `isReminderEventStillValid`), the notifier cron `apps/engines/src/apps/notifier/cron/`, the reminder domain `packages/domain/src/reminders/`, the Yjs save hook `apps/yjs/src/persistence.ts` `storePageDocument`, the comments sidebar pattern `apps/web/src/components/page/comments/{comments-context,comments-sidebar,comment-toggle-button}.tsx` + `page-view.tsx`, `page-actions-menu.tsx`/`page-actions-toolbar.tsx`, the cl2 `publicSitesEnabled` plan-feature pattern (`billing.dto.ts` + `billing.repository.ts`), the cl4C row-access resolver (for reminder access-recheck).

---

## File Structure

**Created:**
- `packages/domain/src/page-history/` — module (dto/repo/service: `RevisionCaptureService` + restore).
- `apps/engines/src/apps/history/` — the prune cron service + module.
- `packages/notifications/src/page-activity.ts` — `notifyPageActivity` + dedup guard + the new event helpers.
- `apps/web/src/components/page/history/{history-context,history-sidebar,history-toggle-button,revision-list,revision-preview}.tsx`.
- `apps/web/src/components/page/notify-me-menu.tsx`, `apps/web/src/components/database/cell-editors/date-reminder-popover.tsx`.
- Tests across domain/trpc + `apps/e2e/page-history-notify.spec.ts`.

**Modified:**
- `packages/db/prisma/schema.prisma` + migration (3 tables + enums + event types + Page/User relations).
- `packages/notifications/src/{catalog.ts,helpers.ts,reminders.ts}` (new event types + DB reminder rebuild).
- `apps/yjs/src/persistence.ts` (revision capture in storePageDocument).
- `packages/domain/src/pages/services/pages.service.ts` (structural revision capture on rename/move/archive/restore) + container wiring.
- `packages/domain/src/billing/dto/billing.dto.ts` + `.../billing/repositories/billing.repository.ts` + `apps/engines/.../plan-features.service.ts` (pageHistoryDays).
- `packages/trpc/src/routers/{page.ts,notification.ts,database/*}.ts` (history procedures, page-notification-preference procedures, db-date-reminder procedures, notify triggers in comment/cell paths).
- `apps/web/src/components/page/{page-actions-menu.tsx,page-view.tsx}`, the notifications popover (grouping), `database/cell-editors/date-cell.tsx`.

---

## Phase A — Schema + plan feature

### Task A1: migration — PageRevision, PageNotificationPreference, DatabaseDateReminder, event types

**Files:** Modify `packages/db/prisma/schema.prisma`; create migration.

- [ ] **Step 1:** Add enums `PageRevisionAction { EDIT TITLE_CHANGE MOVE ARCHIVE RESTORE PUBLISH }`, `PageNotificationLevel { ALL_COMMENTS REPLIES_AND_MENTIONS ALL_UPDATES IMPORTANT_UPDATES }`. Add the three models per the spec, with `Page` reverse relations (`revisions PageRevision[]`, `notificationPreferences PageNotificationPreference[]`) and `User` reverse relations (`pageRevisions PageRevision[] @relation("PageRevisionActor")`, `pageNotificationPreferences PageNotificationPreference[]`, `databaseDateReminders DatabaseDateReminder[]`), plus `DatabaseProperty.dateReminders DatabaseDateReminder[]` and `DatabaseRow.dateReminders DatabaseDateReminder[]`. Add to `NotificationEventType`: `COMMENT_REPLY DATABASE_UPDATE DATABASE_PERSON_ASSIGNED DATABASE_DATE_REMINDER` (+ `PAGE_REVISION_RESTORED` if used).
- [ ] **Step 2:** `pnpm --filter @repo/db exec prisma validate` → valid.
- [ ] **Step 3:** Generate migration on a FRESH scratch DB (`anynote_p5_scratch`, role user/password): baseline `migrate deploy`, then `migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` → `packages/db/prisma/migrations/20260609160000_notifications_history/migration.sql` (ALTER TYPE ADD VALUE for the event types + CREATE TYPE x2 + CREATE TABLE x3 + indexes/FKs).
- [ ] **Step 4:** Re-deploy fresh + `migrate diff ... --exit-code` → "No difference detected". Apply the additive DDL to the shared dev DB (enum ADD VALUE IF NOT EXISTS + CREATE TYPE/TABLE IF NOT EXISTS + indexes/FKs). Drop scratch.
- [ ] **Step 5:** `prisma generate`; commit `feat(db): page revisions, notify-me preferences, database date reminders`.

### Task A2: pageHistoryDays plan feature

**Files:** Modify `packages/domain/src/billing/dto/billing.dto.ts`, `.../billing/repositories/billing.repository.ts`, `apps/engines/src/apps/indexer/services/plan-features.service.ts`.

- [ ] **Step 1:** Add `pageHistoryDays: number | null` to `PlanFeatures`. In `planToFeatures`, parse from `Plan.features` JSON: find an entry like `"pageHistory:30"` → 30; `"pageHistory:unlimited"` or absent → null (unlimited) for paid, or a default (e.g. 7) for personal — pick a sensible default and document it. Add the same parse to the engines `plan-features.service.ts` so the prune cron can read it.
- [ ] **Step 2:** `pnpm --filter @repo/domain check-types && pnpm --filter @repo/domain test`. Commit `feat(domain): pageHistoryDays retention plan feature`.

---

## Phase B — Revision capture + history domain (TDD)

### Task B1: page-history domain module — capture + restore

**Files:** Create `packages/domain/src/page-history/` (dto/repo/service/module/tokens/index); modify `container.ts`, `index.ts`. Test `packages/domain/test/page-history/...`.

- [ ] **Step 1: Failing tests** (mock repo): `captureContentRevision` writes a revision; THROTTLE: a second content capture for the same page+actor within `HISTORY_MIN_INTERVAL_MS` is skipped (no write); a different actor or after the interval → writes. `captureStructuralRevision` always writes (TITLE_CHANGE/MOVE/ARCHIVE/RESTORE). `restoreRevision(pageId, revisionId, actorId)` writes the revision's content back to the page (via the page repo) AND records a new RESTORE revision; throws if the page is deleted. `listRevisions`/`getRevisionPreview` read access enforced by the caller (tRPC); the service trusts the actor.
- [ ] **Step 2:** Run `pnpm --filter @repo/domain test page-history` → FAIL.
- [ ] **Step 3:** Implement. `RevisionCaptureService` (`constructor(repo, uow)`): `captureContentRevision`, `captureStructuralRevision`, `listRevisions`, `getRevisionPreview`, `restoreRevision`. The throttle compares the latest revision's `createdAt` + `actorId`. Wire the module into `container.ts` + export from `index.ts`.
- [ ] **Step 4:** Run → PASS. Commit `feat(domain): page-history capture + restore service`.

### Task B2: structural capture in the page service

**Files:** Modify `packages/domain/src/pages/services/pages.service.ts` (inject `RevisionCaptureService` via the module DI, like Kanban/Database); `packages/domain/src/pages/pages.module.ts`.

- [ ] **Step 1: Failing test:** rename → a TITLE_CHANGE revision; move → MOVE; archive → ARCHIVE; restore/unarchive → RESTORE (extend `pages.service.test.ts`; update mocks for the new dependency).
- [ ] **Step 2:** Run → FAIL. Implement: inject `PAGE_HISTORY.Service` into `PageService`; in `rename`/`move`/`archive`/`unarchive`, after the mutation, call `captureStructuralRevision`. Avoid a hard cross-module cycle (use a shared port if check-architecture complains — the cl3 `ItemPageCreator` pattern).
- [ ] **Step 3:** Run → PASS + `pnpm check-architecture` clean. Commit `feat(domain): capture structural page revisions on rename/move/archive/restore`.

### Task B3: Yjs save-hook content capture

**Files:** Modify `apps/yjs/src/persistence.ts`.

- [ ] **Step 1:** In `storePageDocument`, BEFORE/within the page-update transaction, capture a content revision directly via the yjs Prisma client (apps/yjs has no @repo/domain): a focused `capturePageRevisionTx(tx, {pageId, content, contentYjs, metadata})` applying the SAME throttle (query the latest revision's createdAt; skip if < HISTORY_MIN_INTERVAL_MS and same actor — note apps/yjs may not have a reliable actorId here; if not, throttle purely by time-since-last-revision-for-the-page, which still gives the coarse cadence). Action = EDIT. Only for content-bearing page types. Add a unit test if apps/yjs has a test harness; else verify via the e2e/manual.
- [ ] **Step 2:** `pnpm --filter @repo/yjs-server check-types` (or the yjs package filter). Commit `feat(yjs): capture page content revisions on save (throttled)`.

### Task B4: tRPC history procedures

**Files:** Modify `packages/trpc/src/routers/page.ts` (or a `page-history` sub-router). Test `packages/trpc/test/page-history.test.ts`.

- [ ] **Step 1: Failing tests:** `listRevisions({pageId})` returns revisions (edit-access required — a non-editor → FORBIDDEN); `getRevisionPreview({pageId, revisionId})` returns content (edit-access); `restoreRevision({pageId, revisionId})` reverts + records a RESTORE revision (edit-access); a viewer who lost access can't list/preview/restore.
- [ ] **Step 2:** Run → FAIL. Implement: `listRevisions`/`getRevisionPreview` (`assertPageEditAccess` — history requires edit), `restoreRevision` (`assertPageEditAccess`) → `domainSvc.pageHistory.*`.
- [ ] **Step 3:** Run → PASS. Commit `feat(trpc): page history list/preview/restore (edit-gated)`.

### Task B5: retention prune cron (apps/engines)

**Files:** Create `apps/engines/src/apps/history/{history-prune.service.ts,history.module.ts}`; wire into the engines app module.

- [ ] **Step 1:** A NestJS cron service (`@Cron(process.env.HISTORY_PRUNE_CRON ?? '0 3 * * *')`) that, per workspace, reads `pageHistoryDays` (via the engines plan-features service) and deletes `PageRevision` rows older than now - days (skip unlimited). Add the env var to `.env.example` + `turbo.json` globalEnv. A focused spec asserting the prune query (mock prisma): rows older than the window are deleted, newer kept, unlimited skipped.
- [ ] **Step 2:** `pnpm --filter engines test && pnpm --filter engines check-types`. Commit `feat(engines): page revision retention prune cron`.

---

## Phase C — Notify-me + Inbox dedup/grouping

### Task C1: notification event types + page-activity helper + dedup

**Files:** Modify `packages/notifications/src/{catalog.ts,helpers.ts}`; create `packages/notifications/src/page-activity.ts`. Test `packages/notifications/test/...` (if the package has tests) or via trpc.

- [ ] **Step 1:** Add `EVENT_CATALOG` descriptors for `COMMENT_REPLY`, `DATABASE_UPDATE`, `DATABASE_PERSON_ASSIGNED`, `DATABASE_DATE_REMINDER` (COLLABORATION; default `['IN_APP','EMAIL']`; locked `['IN_APP']`). Add `notify.commentReply`, `notify.databaseUpdate`, `notify.databasePersonAssigned`, `notify.databaseDateReminder` helpers (typed payloads incl. `pageId`, `threadId?`, `actorId`).
- [ ] **Step 2:** `page-activity.ts` — `notifyPageActivity(prisma, {pageId, actorId, kind, recipients, payload})` that, before emitting, applies a DEDUP guard: skip emitting to a recipient if an UNREAD in-app notification with the same `(pageId, actorId, type)` was created within `DEDUP_WINDOW_MS` (query `NotificationInApp join NotificationEvent`). Direct mentions/replies bypass dedup. A `resolvePageActivityRecipients(prisma, pageId, kind)` reads `PageNotificationPreference` (+ the implicit replies/mentions defaults) to pick recipients. Add a unit test for the dedup guard + recipient resolution.
- [ ] **Step 3:** Commit `feat(notifications): page-activity helper with burst dedup + new event types`.

### Task C2: page-notification-preference tRPC + comment-reply/all-comments triggers

**Files:** Modify `packages/trpc/src/routers/notification.ts` (or page router) + `packages/trpc/src/routers/comment.ts`. Test.

- [ ] **Step 1: Failing tests** (real-DB): `setPageNotificationPreference`/`get`/`clear`; a comment reply notifies thread participants (`COMMENT_REPLY`); a user with `ALL_COMMENTS` pref gets a comment notification; clearing the pref stops pref-driven notifications but a direct @mention still notifies; the actor doesn't notify self.
- [ ] **Step 2:** Run → FAIL. Implement the 3 preference procedures (page read access). Extend `notifyNewComment` in `comment.ts`: replies → `notify.commentReply` for participants; resolve `ALL_COMMENTS`/`ALL_UPDATES` page-pref users → notify on any comment; keep the existing mention path; route through `notifyPageActivity` for dedup where appropriate.
- [ ] **Step 3:** Run → PASS. Commit `feat(trpc): notify-me page preferences + comment-reply/all-comments notifications`.

### Task C3: database update + person-assignment notifications

**Files:** Modify `packages/trpc/src/routers/database/cell.ts` (+ the relation/person paths) and the database domain service or the trpc layer. Test.

- [ ] **Step 1: Failing tests:** assigning a user to a PERSON property → `DATABASE_PERSON_ASSIGNED` to that user (respecting db-page access + the page's notification setting); a database property change → `DATABASE_UPDATE` to `ALL_UPDATES` pref users; a status/assignee/due-date change → also to `IMPORTANT_UPDATES` users; an unrelated property change → NOT to `IMPORTANT_UPDATES` users; the actor doesn't notify self; a user without row access gets no content-bearing notification.
- [ ] **Step 2:** Run → FAIL. Implement: in the `updateCellValue` tRPC path (it has the workspace/session), after a successful cell write, emit the appropriate database notification via `notifyPageActivity`/`notify.databaseUpdate`/`databasePersonAssigned`, classifying important vs all updates by the property type/role, and filtering recipients by row access (reuse the cl4C resolver).
- [ ] **Step 3:** Run → PASS. Commit `feat(trpc): database update + person-assignment notifications (access-filtered)`.

### Task C4: Inbox grouping view-model

**Files:** Modify `packages/trpc/src/routers/notification.ts` (`list`) + `apps/web/src/components/notifications/notifications-popover-card.tsx` (or a grouping helper).

- [ ] **Step 1:** Group the in-app list by `event.payload.pageId` + `threadId` in the view-model (return grouped buckets, or add a `groupKey` the UI groups on). Render grouped items in the popover/list (a page header with N notifications collapsed). A unit test for the grouping helper (pure: events in → grouped buckets out).
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint && pnpm --filter web test`. Commit `feat(web): group Inbox notifications by page/thread`.

---

## Phase D — Database date reminders

### Task D1: DatabaseDateReminder domain + tRPC + delivery rebuild

**Files:** Create the reminder config handling in the database domain service (or a small `database-reminders` piece); modify `packages/notifications/src/reminders.ts` (a `rebuildDatabaseDateReminderDeliveries`), `packages/trpc/src/routers/database/*`. Test.

- [ ] **Step 1: Failing tests:** `setDatabaseDateReminder({pageId, propertyId, rowId, offsetMinutes, timezone})` (self-target = ctx.user) creates the config + builds NotificationDelivery rows with `nextAttemptAt = <date cell value> - offset`; `clearDatabaseDateReminder` cancels deliveries; changing the DATE cell reschedules; `getDatabaseDateReminder`; cannot target another user (no userId in the input — always self); a user without row access can't set a reminder; the fired reminder is access-rechecked (the dispatcher validity check rejects if the user lost access).
- [ ] **Step 2:** Run → FAIL. Implement: the tRPC procedures (read access to set; self-target), the config CRUD, and a `rebuildDatabaseDateReminderDeliveries` reusing the `rebuildDeliveries` machinery (synthesize a delivery from the date cell value + offset + the `DATABASE_DATE_REMINDER` event). Extend the dispatcher's validity check (`isReminderEventStillValid` analog) to re-check row access at fire time. Reschedule on date-cell change (hook in `updateCellValue` when the property is the reminder's DATE property).
- [ ] **Step 3:** Run → PASS. Commit `feat(database): self-targeted date-cell reminders via the notification pipeline`.

---

## Phase E — UI

### Task E1: DocumentHistoryPanel

**Files:** Create `apps/web/src/components/page/history/{history-context,history-sidebar,history-toggle-button,revision-list,revision-preview}.tsx`; modify `page-view.tsx` (mount the provider+sidebar) + `page-actions-toolbar.tsx`/`page-actions-menu.tsx` (the "История" entry).

- [ ] **Step 1:** Mirror the comments sidebar: `PageHistoryProvider` (panelOpen/toggle), `<HistorySidebar>` in the page layout flex row, a toolbar toggle. The sidebar lists `listRevisions` grouped by date (actor/action/time + summary), a selected revision `getRevisionPreview` readonly, a restore button with confirm (`restoreRevision`). States: no history; unavailable by plan (catch the plan error); not restorable; restore conflict. Hide the entry for non-editors.
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint && pnpm --filter web test`. Commit `feat(web): document history side panel (preview + restore)`.

### Task E2: Notify-me menu + date-cell reminder UI

**Files:** Create `apps/web/src/components/page/notify-me-menu.tsx`, `apps/web/src/components/database/cell-editors/date-reminder-popover.tsx`; modify `page-actions-menu.tsx`, `database/cell-editors/date-cell.tsx`.

- [ ] **Step 1:** `NotifyMeMenu` — a page-action submenu showing the level options (TEXT: Все комментарии / Ответы и упоминания; DATABASE: Все обновления / Важные обновления / Ответы и упоминания) reading/writing `getPageNotificationPreference`/`setPageNotificationPreference`/`clear`. `DateReminderPopover` on the date cell: set an offset + a self-reminder (`setDatabaseDateReminder`), show a reminder-status bell in the date cell when set, clear via `clearDatabaseDateReminder`.
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint && pnpm --filter web test`. `set -a; . ./.env; set +a; pnpm --filter web build` → exit 0. Commit `feat(web): Notify-me menu + database date-cell reminder`.

---

## Phase F — E2E + gate

### Task F1: Playwright spec

**Files:** Create `apps/e2e/page-history-notify.spec.ts`.

- [ ] **Step 1:** Using `signUpAndAuthAs`: create a TEXT page, make a title change (which captures a TITLE_CHANGE revision via the domain — reliable without yjs), open История, see ≥1 revision, preview it, restore it (assert the title reverts). Set a Notify-me level → it persists (reload). (Content-edit revisions need yjs — assert the structural-revision path which works without yjs; document the yjs caveat.) Set a date-cell reminder on a database date cell → its status shows.
- [ ] **Step 2:** `pnpm exec playwright test apps/e2e/page-history-notify.spec.ts --retries 1` → pass. Commit `test(e2e): page history restore + notify-me + date reminder`.

### Task F2: full gate + changelog

- [ ] **Step 1:** `pnpm check-types` (22/22), `pnpm lint`, `pnpm check-architecture`, `pnpm --filter @repo/domain test`, `pnpm --filter @repo/trpc test`, `pnpm --filter web test`, `pnpm --filter engines test`, `pnpm --filter @repo/notifications test` (if present) → all pass.
- [ ] **Step 2:** `set -a; . ./.env; set +a; pnpm --filter web build` → succeeds.
- [ ] **Step 3:** Re-verify migration on a fresh scratch DB (zero drift).
- [ ] **Step 4:** Update `docs/changelog.md` (История страниц, Уведомлять меня, напоминания по дате). Commit.

---

## Self-review notes

- Spec coverage: A1–A2 = schema + retention feature; B1–B5 = revision capture (domain + yjs hook + structural) + tRPC + prune cron (5.1+5.2 backend); C1–C4 = notify-me prefs + event types + dedup + db-update/person notifications + Inbox grouping (5.3); D1 = db date reminders (5.4); E1–E2 = history panel + notify-me menu + reminder UI; F = e2e + gate.
- TWO capture sites (yjs hook B3 for content + page service B2 for structural) — explicit; apps/yjs writes revisions via its own Prisma client (no @repo/domain in that process). Throttle by time-since-last-revision-for-the-page.
- Dedup guard (C1) collapses burst events; direct mentions/replies bypass it. Access-recheck at fire (D1) prevents content-bearing reminders after access loss (reuses the cl4C resolver / a validity check).
- Retention prune is a JOB (B5), never an ad-hoc delete in a read API. `pageHistoryDays` plan feature (A2) bounds it.
- Type consistency: `captureContentRevision`/`captureStructuralRevision`/`restoreRevision`/`listRevisions`/`getRevisionPreview` (B1) used by B2/B3/B4; `PageNotificationLevel`/`notifyPageActivity`/`resolvePageActivityRecipients` (C1) used by C2/C3; `setDatabaseDateReminder`/`rebuildDatabaseDateReminderDeliveries` (D1) consistent.
- Notify-me naming is "Уведомлять меня" everywhere (never "подписка"). Property-visibility-style cosmetic concerns N/A here.
