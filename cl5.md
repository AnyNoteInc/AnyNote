# Notifications, document history, Notify me preferences

## Описание фазы

Эта фаза добавляет audit/history and notification surfaces around documents and databases: page revisions, restore, Notion-style `Notify me` preferences, Inbox notifications and database/date reminders.

Notion alignment sources to use during implementation:

- https://www.notion.com/help/duplicate-delete-and-restore-content — page version history, restore, access and retention behavior.
- https://www.notion.com/help/updates-and-notifications — Inbox grouping, page/database `Notify me` levels, person-property notifications.
- https://www.notion.com/help/notification-settings — delivery channels, active-page suppression, notification settings.
- https://www.notion.com/help/comments-mentions-and-reminders — comments, mentions, replies and mention notifications.
- https://www.notion.com/help/reminders — page reminders and database `Date` property reminders.
- https://www.notion.com/help/use-notion-calendar-with-notion — database date/calendar behavior and access constraints.
- https://www.notion.com/releases/2025-11-14 — grouped Inbox/page discussion notification direction.

## Полный ожидаемый результат

- PageRevision stores meaningful historical snapshots for TEXT pages using AnyNote's Yjs persistence constraints.
- Users can open DocumentHistoryPanel, preview old versions, see change highlights where feasible and restore selected revision.
- Users can choose Notion-style page notification levels instead of a generic "subscription" UX.
- Inbox notifications are grouped by page/comment thread and rate-limited/deduplicated to avoid spam.
- Mentions, replies, comments, person properties and reminders follow Notion notification semantics.
- Database `Date` values can schedule per-cell reminders and notifications.
- Notification logic respects page/database access, page-level database rules and
  property visibility where relevant.

## Scope и ограничения

Avoid capturing every keystroke or cursor update. History should be useful and storage-aware. Notifications must never leak hidden/private content to users who lost access.

Important Notion/AnyNote constraints:

- Version history should be Notion-like, not raw audit logging: capture useful snapshots during active editing on a coarse cadence and after editing settles. Notion currently records while actively editing roughly every 10 minutes and another version shortly after the last edit; use that as the behavior target, adjusted for AnyNote's Yjs persistence model.
- Retention should map to existing AnyNote plan features/config. Do not hard-code Notion plan names into user-facing UI. If the plan system supports tiers, use a config that can express Notion-like windows such as 7/30/90 days and unlimited.
- Access to version history and restore should require edit-level access to the page. Restore must create a new current version and keep prior snapshots restorable within retention.
- Regular TEXT pages should not invent broad content-edit push notifications unless explicitly marked as an AnyNote extension. Notion's regular page `Notify me` levels are `All comments` and `Replies and @mentions`; database pages additionally support `All updates` and `Important updates`.
- "Subscription" may be an internal implementation detail, but user-facing UI and API naming should prefer `Notify me` / notification preference. If an explicit follow/subscription model is kept, mark it as an AnyNote extension and avoid claiming Notion parity.
- Mentions and comment replies notify directly; they do not automatically opt the user into all future page updates. Store thread/page preference only when needed to implement reply notifications or explicit `Notify me`.
- Database reminders are tied to a `Date` property value. Reminding another person is Notion-like for page inline reminders when a person is mentioned in the same block, but Notion does not support assigning database date reminders to someone else.
- Notion Calendar can view/manage database pages with `Date` properties subject to access. Do not treat calendar visibility as a notification subscription.
- Preserve AnyNote's internal notification pipeline and permissions checks; add event kinds/preferences without bypassing existing delivery, read/archive, or ACL logic.

## Рабочее задание фазы

Цель: добавить историю документа, восстановление версии, Notion-style `Notify me`
preferences, Inbox notifications and database date reminders.

## Prompt 5.1 - PageRevision model and capture service

```text
Цель: хранить пользовательскую историю версий TEXT pages in a Notion-like way,
without turning Yjs persistence into per-keystroke audit logging.

Ориентиры по коду и текущей реализации:
- packages/db/prisma/schema.prisma Page
- apps/yjs/src/persistence.ts
- packages/trpc/src/routers/page.ts
- apps/web/src/components/page/**

Сделай:
1. Добавь PageRevision model:
   - pageId;
   - actorId;
   - action type, например edit/title_change/move/archive/restore;
   - content snapshot Json nullable;
   - contentYjs Bytes nullable;
   - metadata snapshot, including title, icon/cover if present, page type,
     parent/workspace references and lightweight change summary/highlights;
   - createdAt.
2. Добавь retention policy field/config by existing AnyNote plan features if
   current plan system supports it:
   - do not rename plans to Notion plans;
   - express a configurable retention window such as 7/30/90 days/unlimited
     when the product tiers can support it;
   - prune expired revisions with a service/job boundary, not ad hoc deletes
     inside read APIs.
3. Добавь RevisionCaptureService:
   - capture on title/content significant changes, move/archive/restore and
     any existing publish-like operation;
   - target Notion-style useful snapshots: during active editing on a coarse
     cadence and after editing settles;
   - avoid capturing every keystroke if Yjs persists too often; use debounce or
     explicit save/update events from apps/yjs/src/persistence.ts;
   - ignore cursor/presence-only Yjs updates.
4. Добавь tRPC:
   - listRevisions;
   - getRevisionPreview;
   - restoreRevision.
5. Permissions and safety:
   - list/preview/restore require edit-level page access;
   - restore creates a new revision/action and does not erase retained history;
   - never expose snapshot content after the user loses access.
6. Tests:
   - revision created on meaningful update;
   - no revision for cursor/presence/no-op Yjs updates;
   - list sorted/groupable;
   - retention filters/prunes as configured;
   - restore reverts content/title safely and records a restore revision;
   - unauthorized user cannot list/preview/restore.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm check-types

Критерий готовности:
- История полезна, Notion-like, and не раздувает DB на каждое изменение курсора.
```

## Prompt 5.2 - DocumentHistoryPanel UI

```text
Цель: сделать историю доступной пользователю в редакторе.

Ориентиры по коду и текущей реализации:
- PageRevision API, созданный в задаче 5.1 этой фазы
- apps/web/src/components/page/page-actions-menu.tsx
- apps/web/src/components/page/editor-content*
- comments sidebar/panel patterns

Сделай:
1. Добавь action "История" in page actions.
2. Добавь `DocumentHistoryPanel`:
   - revisions grouped by date;
   - actor/action/time and compact change summary/highlights where available;
   - selected revision preview readonly;
   - restore button with confirmation.
3. Обработай states:
   - no history;
   - history unavailable by plan/retention;
   - revision no longer restorable;
   - restore conflict if page deleted/archived.
4. Align behavior:
   - require edit-level access for the action and API calls;
   - make clear that highlights are best-effort and may not capture every
     single change;
   - keep AnyNote side-panel UX even though Notion may present history in a
     window.
5. Tests:
   - open history;
   - preview revision;
   - restore revision.

Дизайн:
- Side panel, not modal, so user sees current page context.
- Keep typography compact.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- focused Playwright history spec

Критерий готовности:
- Пользователь может увидеть и восстановить прошлую версию.
```

## Prompt 5.3 - Notify me preferences and Inbox notifications

```text
Цель: добавить Notion-style `Notify me` preferences and Inbox notifications,
not a generic page subscription feature.

Ориентиры по коду и текущей реализации:
- packages/db/prisma/schema.prisma Notification*
- packages/trpc/src/routers/notification.ts
- apps/web/src/components/notifications/**
- page actions/menu files

Сделай:
1. Добавь notification preference storage, например PageNotificationPreference:
   - userId;
   - pageId;
   - level enum;
   - createdAt/updatedAt.
   User-facing naming must be `Notify me` / notification preference, not
   "subscribe", unless existing code forces a different internal name.
2. Supported levels:
   - default implicit behavior: replies and @mentions notify without requiring
     an explicit preference row;
   - regular TEXT pages: `ALL_COMMENTS` and `REPLIES_AND_MENTIONS`;
   - database pages: `ALL_UPDATES`, `IMPORTANT_UPDATES`,
     `REPLIES_AND_MENTIONS`;
   - `ALL_UPDATES` for regular TEXT page content edits is an AnyNote extension
     only if product explicitly needs it; do not claim Notion parity for it.
3. Добавь tRPC:
   - setPageNotificationPreference;
   - clearPageNotificationPreference;
   - getPageNotificationPreference.
4. Добавь notification event/category mapping:
   - mention;
   - comment_reply;
   - all_comments;
   - database_all_updates for database comments and property changes;
   - database_important_updates for database comments plus status/assignee/due
     date changes;
   - reminder;
   - page_invite if existing sharing flow supports it.
5. Добавь grouping/dedup/rate limit:
   - Inbox groups by page and comment thread where possible;
   - avoid repeated push/email for the same page/thread burst;
   - if presence/viewer state exists, suppress notifications while the target
     user is actively viewing the trigger page.
6. Mention/comment behavior:
   - @mentions notify the mentioned user directly;
   - replies notify participants according to existing comment-thread model;
   - @mention/comment must not silently opt the user into all future page or
     database updates;
   - adding a user to a database Person property should notify according to
     the database property notification setting if such settings exist or are
     added here.
7. UI:
   - page action menu item `Notify me`;
   - regular page options: `All comments`, `Replies and @mentions`;
   - database page options: `All updates`, `Important updates`,
     `Replies and @mentions`;
   - Inbox item menu can change preference for that page if current notification
     UI supports per-item actions.
8. Tests:
   - mention receives Inbox notification and no hidden content leaks;
   - comment reply notifies expected participants;
   - `All comments` receives page comment notifications;
   - clearing preference stops preference-driven notifications but not direct
     mentions/replies;
   - database `All updates` receives property-change notifications;
   - database `Important updates` receives status/assignee/due-date changes but
     not unrelated property changes;
   - actor does not notify self unless existing behavior already does;
   - permission loss before delivery prevents content-bearing notification.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Users can intentionally control Notion-like page/database notifications
  without inventing misleading "subscription" parity.
```

## Prompt 5.4 - Database Date reminders and calendar-style notifications

```text
Цель: связать database `Date` properties with reminders/notifications in the
same product shape as Notion reminders.

Ориентиры по коду и текущей реализации:
- Database date property implementation
- Notification infrastructure
- Existing reminders router/components

Сделай:
1. Добавь DatabaseDateReminder settings:
   - propertyId;
   - rowId/pageId for the database page;
   - remindAt or offset relative to the Date value;
   - timezone and optional specific time;
   - creator/target user, but for database reminders target should be the
     current user unless AnyNote deliberately adds an extension.
2. Добавь scheduler or reuse existing reminder scheduler.
3. Добавь notification category for reminders that routes to the existing Inbox
   and delivery pipeline.
4. UI:
   - date cell reminder editor;
   - show reminder status in the date cell/date picker;
   - do not add "database event subscription" as a Notion-parity feature.
5. Calendar behavior:
   - if AnyNote has a calendar view, database reminders should follow the same
     Date-property value used by that view;
   - calendar visibility is not a notification subscription;
   - respect database/page access, including page-specific permissions inside
     a database.
6. Page inline reminders:
   - do not implement broad page `@remind` parsing unless an existing reminders
     system already has that shape;
   - if implemented, Notion-like reminder for someone else requires a person
     mention in the same block; database date reminders remain self-targeted
     unless marked as AnyNote extension.
7. Tests:
   - reminder scheduled;
   - notification generated;
   - reminder fires through Inbox/read/archive delivery;
   - property ACL respected;
   - user without access receives no content-bearing reminder;
   - database reminder cannot target someone else unless marked/tested as
     AnyNote extension.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Database Date values can trigger real, permission-safe reminders without
  adding non-Notion subscription semantics.
```
