# Page reminders — design

Date: 2026-05-11
Status: approved (brainstorm)

## Goals

- A `/reminder` slash command that inserts an inline chip into the editor on
  `/workspaces/{workspaceId}/pages/{pageId}`. The chip is a Tiptap inline atom
  node carrying a stable UUID and minimal display state (deadline, optional
  label, done flag).
- A create-popover (right after insertion) where the user picks the deadline,
  one or more intermediate reminder offsets, an audience (me / whole workspace
  / list of members), and an optional label.
- An edit-popover (on click) that mirrors the create form plus three
  affordances: bulk postpone (+1d / +7d / +1m), mark done, delete.
- A `Reminder` table in Postgres that is reconciled against the Y.Doc state on
  every editor change. Reminder fan-out reuses the existing notifications/v1
  pipeline: `NotificationEvent` (type `REMINDER_DUE`, category `COLLABORATION`)
  + `NotificationDelivery` rows with `nextAttemptAt = dueAt - offsetMinutes·60s`,
  picked up by the existing notifier cron.
- The chip's visual state is dynamic: gray (plenty of time), yellow (between
  earliest pending offset and the deadline), red (overdue), green (done — wins
  unconditionally).
- Undo (ctrl+z) restores a deleted chip with its UUID intact; reconciliation
  un-deletes the row and re-creates pending deliveries.

## Non-goals

- No workspace-level "all my reminders" dashboard. Reminders are surfaced only
  inline in pages and via the existing notifications bell.
- No recurrence / repeating reminders.
- No custom-time snooze. Bulk postpone is preset-only (+1d / +7d / +1m).
- No new `NotificationCategory` enum value. Reminders use `COLLABORATION` so
  they fall under the existing matrix toggles in `/settings`.
- No edits from the bell popover. The bell is read-only as today; clicking a
  reminder notification scrolls to the chip on the page.
- No mailhog / local SMTP work. Email fan-out reuses existing SendSay/console
  fallback.

## Data model

New tables in `packages/db/prisma/schema.prisma`:

```prisma
model Reminder {
  id            String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId        String              @map("page_id") @db.Uuid
  workspaceId   String              @map("workspace_id") @db.Uuid
  createdById   String?             @map("created_by_id") @db.Uuid
  label         String?             @db.VarChar(200)
  dueAt         DateTime            @map("due_at") @db.Timestamptz(6)
  offsets       Int[]               @default([])
  audience      ReminderAudience    @default(ME)
  doneAt        DateTime?           @map("done_at") @db.Timestamptz(6)
  doneById      String?             @map("done_by_id") @db.Uuid
  deletedAt     DateTime?           @map("deleted_at") @db.Timestamptz(6)
  createdAt     DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  page        Page                @relation(fields: [pageId], references: [id], onDelete: Cascade)
  workspace   Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy   User?               @relation("ReminderAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  doneBy      User?               @relation("ReminderDoneBy", fields: [doneById], references: [id], onDelete: SetNull)
  recipients  ReminderRecipient[]

  @@index([pageId, deletedAt])
  @@index([workspaceId, dueAt])
  @@index([doneAt])
}

model ReminderRecipient {
  reminderId String   @map("reminder_id") @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  reminder   Reminder @relation(fields: [reminderId], references: [id], onDelete: Cascade)
  user       User     @relation("ReminderRecipient", fields: [userId], references: [id], onDelete: Cascade)

  @@id([reminderId, userId])
  @@index([userId])
}

enum ReminderAudience {
  ME
  WORKSPACE
  LIST
}
```

Key choices:

- `offsets Int[]` — offset minutes before `dueAt` (e.g. `[10080, 1440, 60, 0]`
  = week / day / hour / at-deadline). Stored as a Postgres `Int[]` so bulk
  postpone is just an update to `dueAt`; all offsets travel with it. Order is
  not significant in the DB.
- `audience` + `ReminderRecipient`:
  - `ME` and `WORKSPACE` keep `ReminderRecipient` empty.
  - `WORKSPACE` is resolved to current `WorkspaceMember` rows at the moment
    `rebuildDeliveries` runs. Members added later receive future reminders;
    members removed lose future ones. No mid-stream re-fan-out.
  - `LIST` materialises explicit recipient rows.
- `deletedAt` enables soft-delete so undo can restore.
- `Page` cascade so deleting a page nukes its reminders.

Notification linkage uses the existing `NotificationEvent.payload Json` —
event rows carry `{ reminderId, offsetMinutes, dueAt, label, pageId,
workspaceId }`. `resourceUrl` is set to
`/workspaces/${workspaceId}/pages/${pageId}#reminder-${reminderId}` so bell
clicks scroll to the chip.

Notifications catalog extension in `packages/notifications/src/catalog.ts`:

```ts
NotificationEventType += 'REMINDER_DUE'
EVENT_CATALOG.REMINDER_DUE = {
  category: 'COLLABORATION',
  defaultChannels: ['IN_APP', 'EMAIL', 'WEB_PUSH'],
  lockedChannels: ['IN_APP'],
}
```

## Tiptap node

Four new files in `packages/editor/src/extensions/`:

### `reminder.schema.ts`

Server-safe schema (consumed by Hocuspocus and SSR). `Node.create({…})`:

- `name: 'reminder'`, `group: 'inline'`, `inline: true`, `atom: true`,
  `selectable: true`, `draggable: false`.
- Attributes: `id` (UUID), `dueAt` (ISO string), `offsets` (number[]),
  `audience` ('ME' | 'WORKSPACE' | 'LIST'), `label` (string | null),
  `recipients` (string[] of user IDs, only meaningful for `audience='LIST'`),
  `doneAt` (ISO string | null).
- `parseHTML`/`renderHTML` round-trip these as `data-*` attributes on a
  `<span data-type="reminder">`.

### `reminder.tsx`

Adds `addNodeView(ReactNodeViewRenderer(ReminderView))`. The `ReminderView`
component:

- Renders an inline `Box` chip via `NodeViewWrapper as="span"
  contentEditable={false}`.
- Reads `node.attrs`, computes `state` via `computeReminderState(attrs, now)`
  (see "Color logic" below), looks up colours from `REMINDER_COLORS`.
- On click (when `editor.isEditable`): calls the editor-context method
  `openReminderEdit(id, anchorEl)`, which renders a single page-level popover
  (see "Popovers" below).
- Renders bell icon + label (default `'Напомнить'`) + deadline relative
  (`formatRelative` from `date-fns/locale/ru`). When `doneAt` is set, the label
  gets `text-decoration: line-through`.
- For a freshly-inserted chip without `dueAt` (placeholder state) the chip
  shows `"Установить дату"` in muted gray and auto-opens the create-popover
  the first time it mounts.

### `slash-items.ts` (modified)

New item in the `base` group:

```ts
{
  id: 'reminder',
  group: 'base',
  label: 'Напоминание',
  keywords: ['reminder', 'напоминание', 'дедлайн', 'deadline', 'todo'],
  icon: createElement(NotificationsIcon),
  run: ({ editor, range }) => {
    const id = crypto.randomUUID()
    editor.chain().focus()
      .deleteRange(range)
      .insertContent({ type: 'reminder', attrs: { id, dueAt: '', offsets: [1440, 0], audience: 'ME' } })
      .run()
    handlers.openReminderCreate(id)
  },
}
```

`handlers.openReminderCreate` is a new method on the `SlashItemHandlers` type
piped through from `AnyNoteEditor` props.

### `extensions/index.ts` and `extensions/server.ts`

Register `Reminder` in the client extensions array and `ReminderSchema` in the
server export (same dual-export pattern as `PageLink`).

## Color logic

`packages/editor/src/extensions/reminder/state.ts`:

```ts
export type ReminderColor = 'gray' | 'yellow' | 'red' | 'green'

export function computeReminderState(
  attrs: { dueAt: string; offsets: number[]; doneAt: string | null },
  now: Date,
): ReminderColor {
  if (attrs.doneAt) return 'green'
  if (!attrs.dueAt) return 'gray'
  const due = new Date(attrs.dueAt).getTime()
  if (now.getTime() >= due) return 'red'
  const earliestOffsetMinutes = attrs.offsets.length ? Math.max(...attrs.offsets) : 0
  const yellowStart = due - earliestOffsetMinutes * 60_000
  return now.getTime() >= yellowStart ? 'yellow' : 'gray'
}
```

The `useReminderState(attrs)` hook subscribes to a single shared
`useReminderTick(60_000)` interval (rendered once at the editor root, via
React context) so all chips on a page re-render together once a minute.

## Popovers

A single component `<ReminderPopover mode="create" | "edit" />` rendered once
inside `PageRenderer` and controlled via a page-level context (`pageEditor`,
already used for outline / move-dialog). The chip's `onClick` calls
`pageEditor.openReminderEdit(id, anchor)`; the slash command calls
`openReminderCreate(id)` (anchor resolved by locating the chip DOM node by
`data-id`).

### Form fields (both modes)

1. **Label** — `<TextField>` (200 chars max).
2. **Дедлайн** — MUI `DateTimePicker` (from `@mui/x-date-pickers`; add to
   `@repo/ui` if not present, with `LocalizationProvider`/`AdapterDateFns` and
   `ru` locale).
3. **Напомнить заранее** — six checkboxes rendered top-down in order
   *closest-to-deadline first*:
   - `0`   — В момент истечения
   - `60`  — За 1 час
   - `1440` — За 1 день
   - `4320` — За 3 дня
   - `10080` — За 1 неделю
   - `43200` — За 1 месяц
4. **Для кого** — radio group `Только я` / `Весь workspace` / `Выбрать
   участников`. The list option expands a multi-select using
   `trpc.workspace.listMembers.useQuery({ workspaceId })`.

Validation: submit disabled when `dueAt` is in the past, `dueAt` is empty, or
when `audience='LIST'` and `recipients` is empty.

### Edit-only extras

- **Перенести все напоминания** — three text-button chips: `+1 день`,
  `+1 неделя`, `+1 месяц`. Each updates the local form state's `dueAt`
  (preserving offsets), and submits immediately on click (closes the popover).
  This is the bulk-postpone affordance.
- **☐ Выполнено** — toggling sets `doneAt = new Date().toISOString()` (or
  clears it). Submits immediately.
- **🗑 Удалить** — runs an editor command that finds the node by `id` and
  deletes it (`editor.commands.deleteReminder(id)`). Y.Doc records the
  transaction → undo restores. Popover closes.

### Read-only

When `editor.isEditable === false`, the popover renders the same form with
all inputs disabled and only an `OK` button. No save mutations are issued.

## Sync (Y.Doc ↔ DB reconciliation)

The single point of DB writes for reminders is the `reminder.syncForPage`
mutation. The PageRenderer subscribes to `editor.on('update')`, debounces by
1s, and calls the mutation with the full set of reminder nodes currently
present in the doc.

### Client — `useReminderSync(editor, pageId)` hook

```ts
function useReminderSync(editor: Editor, pageId: string) {
  const sync = trpc.reminder.syncForPage.useMutation()
  const debounced = useMemo(() => debounce(() => {
    const reminders: ReminderSyncInput[] = []
    editor.state.doc.descendants(node => {
      if (node.type.name !== 'reminder') return
      const a = node.attrs
      if (!a.id || !a.dueAt) return       // placeholders skipped
      reminders.push({
        id: a.id, dueAt: a.dueAt, offsets: a.offsets,
        audience: a.audience, label: a.label,
        recipients: a.recipients ?? [], doneAt: a.doneAt,
      })
    })
    sync.mutate({ pageId, reminders })
  }, 1_000), [editor, pageId, sync])

  useEffect(() => {
    editor.on('update', debounced)
    return () => { editor.off('update', debounced); debounced.cancel() }
  }, [editor, debounced])
}
```

The hook is wired in `apps/web/src/components/page/page-renderer.tsx`, gated
on `editor.isEditable === true` (read-only users don't sync).

### Server — `packages/trpc/src/routers/reminder.ts`

Single mutation (also used as the only write path for reminder state):

```ts
syncForPage: protectedProcedure
  .input(z.object({
    pageId: z.string().uuid(),
    reminders: z.array(reminderSyncSchema).max(500),
  }))
  .mutation(async ({ ctx, input }) => {
    const page = await ctx.prisma.page.findUniqueOrThrow({
      where: { id: input.pageId },
      select: { workspaceId: true },
    })
    await assertRole(ctx, page.workspaceId, ['OWNER', 'ADMIN', 'EDITOR'])

    await ctx.prisma.$transaction(async tx => {
      const existing = await tx.reminder.findMany({
        where: { pageId: input.pageId },
        select: {
          id: true, deletedAt: true, doneAt: true, dueAt: true,
          offsets: true, audience: true,
        },
      })
      const existingById = new Map(existing.map(r => [r.id, r]))
      const incomingIds = new Set(input.reminders.map(r => r.id))

      for (const r of input.reminders) {
        const prev = existingById.get(r.id)
        await tx.reminder.upsert({
          where: { id: r.id },
          create: {
            id: r.id, pageId: input.pageId, workspaceId: page.workspaceId,
            createdById: ctx.user.id,
            dueAt: new Date(r.dueAt), offsets: r.offsets,
            audience: r.audience, label: r.label, doneAt: r.doneAt ? new Date(r.doneAt) : null,
          },
          update: {
            dueAt: new Date(r.dueAt), offsets: r.offsets,
            audience: r.audience, label: r.label,
            doneAt: r.doneAt ? new Date(r.doneAt) : null,
            deletedAt: null,
            doneById: r.doneAt && !prev?.doneAt ? ctx.user.id : undefined,
          },
        })

        // Recipients: replace-all only when audience=LIST
        await tx.reminderRecipient.deleteMany({ where: { reminderId: r.id } })
        if (r.audience === 'LIST') {
          await tx.reminderRecipient.createMany({
            data: r.recipients.map(uid => ({ reminderId: r.id, userId: uid })),
          })
        }

        await rebuildDeliveries(tx, { id: r.id, ...r }, page.workspaceId)
      }

      // Soft-delete reminders present in DB but missing from doc
      const toDelete = [...existingById.keys()].filter(id => !incomingIds.has(id))
      if (toDelete.length) {
        await tx.reminder.updateMany({
          where: { id: { in: toDelete }, deletedAt: null },
          data: { deletedAt: new Date() },
        })
        await cancelPendingDeliveries(tx, toDelete, 'reminder removed')
      }
    })
  })
```

### `rebuildDeliveries` (in `packages/notifications/src/reminders.ts`)

For one reminder:

1. Resolve recipients into a concrete `userId[]`:
   - `ME` → `[createdById]`
   - `WORKSPACE` → `workspaceMember.findMany({ workspaceId })` userIds
   - `LIST` → `recipients`
2. For each `(userId, offsetMinutes)` pair compute `fireAt = dueAt -
   offsetMinutes·60_000` and:
   - If `r.doneAt != null` OR `fireAt <= now()`: skip (no future fire).
   - Otherwise create one `NotificationEvent` (type `REMINDER_DUE`, payload
     `{ reminderId, offsetMinutes, dueAt, label, pageId, workspaceId }`) and
     one `NotificationDelivery` per channel resolved through the same
     `resolvePreferences` helper used by `packages/notifications/src/emit.ts`,
     with `nextAttemptAt = fireAt`.
3. Dedupe / sync against existing rows: load PENDING `NotificationDelivery`
   joined to `NotificationEvent` filtered by
   `event.type='REMINDER_DUE' AND event.payload->>'reminderId' = r.id`. For
   each existing pair `(userId, offsetMinutes, channel)`:
   - In the new set with matching `nextAttemptAt`: leave untouched.
   - In the new set with different `nextAttemptAt` (postpone case): update
     `nextAttemptAt`.
   - Not in the new set: SKIPPED. (Reasons: offset removed, recipient
     dropped, audience changed.)
4. If `r.doneAt != null`: SKIP all PENDING deliveries for `reminderId`.

The Json-path filter (`payload->>'reminderId'`) is used per-reminder; the row
volume is bounded by `recipients × offsets` (small, double-digit typically),
so no extra index is required. If the workspace-audience-fanout case grows
problematic, add a partial GIN index on `notification_events.payload` in a
follow-up.

`DELIVERED` / `FAILED` rows are never modified — they remain as history.

### Bell click anchor

`page-renderer.tsx` reads `window.location.hash` on mount. If it matches
`#reminder-{uuid}`, it waits for the editor to be ready, walks the doc to
find the chip's DOM position, calls
`editor.commands.scrollIntoView()` after focusing the position, and toggles a
CSS class on the chip for ~2 seconds to highlight it.

## Permissions

- **Create / edit / delete / postpone / mark-done**: any user with workspace
  role `OWNER | ADMIN | EDITOR` (enforced via existing `assertRole` in the
  sync mutation).
- **View**: any role with read access to the page (chip renders, popover is
  read-only).
- **Audience targeting respects member visibility**: only members of the
  current workspace can be added to `LIST`. The recipient picker is fed by
  `trpc.workspace.listMembers`, which already enforces this.

## Notification firing

No new scheduler. The existing `apps/engines/src/apps/notifier/cron/notifier-cron.service.ts`
runs `runDispatcherTick` every 5 seconds. It selects `NotificationDelivery`
rows with `status='PENDING' AND nextAttemptAt <= now()`, locks via `lockedAt`
/ `lockedBy`, dispatches via the per-channel handler, and marks
`DELIVERED`/`FAILED`/`SKIPPED`.

Per-channel handlers:

- **IN_APP** — already created via `NotificationInApp` insert; the bell picks
  it up via the existing `trpc.notification.unreadCount` poll.
- **EMAIL** — adds a template `packages/mail/src/templates/reminder-due.ts`
  used by the existing dispatcher. Subject:
  - `offsetMinutes > 0`: `🔔 Через ${humanOffset}: ${label || 'Напоминание'}`
  - `offsetMinutes === 0`: `🔔 Напоминание: ${label || 'Дедлайн'}`
  Body: label, formatted dueAt in user locale, link to `resourceUrl`.
  Helper `formatHumanOffset(minutes)` lives in
  `packages/notifications/src/reminders.ts` and returns Russian strings
  ("1 час", "1 день", "1 неделя", "1 месяц" — fixed presets so no
  pluralisation logic is needed).
- **WEB_PUSH** — reuses existing VAPID flow; title/body mirror email,
  `data.url = resourceUrl`.

The dispatcher already respects `NotificationPreference` (category × channel
matrix in `/settings`), so a user who has unchecked `COLLABORATION → EMAIL`
automatically gets no email reminders.

**Pre-fire validity check** (in the per-channel handler for `REMINDER_DUE`):
before dispatching, look up `Reminder.findUnique({ id: payload.reminderId,
select: { deletedAt: true, doneAt: true } })`. If row is missing
(page-cascade) OR `deletedAt != null` OR `doneAt != null`, mark the delivery
SKIPPED with reason `'reminder no longer valid'`. This is the safety net for
the rare race where a Reminder is invalidated between the last sync and
fire-time. The common case is already covered by `cancelPendingDeliveries`
running during sync.

## Edge cases

| Scenario | Behaviour |
|----------|-----------|
| Slash command run, popover closed without saving | Placeholder chip remains until next keystroke; if the popover Cancel button is clicked, the chip is deleted via an editor command. Sync ignores chips without `dueAt`. |
| User deletes chip, then ctrl+z | Y.Doc restores the node with same UUID; next debounced sync upserts and clears `deletedAt`; rebuildDeliveries re-creates pending deliveries. |
| Page deleted | Cascade nukes Reminder rows. Pending NotificationDelivery rows referencing them stay; dispatcher pre-fire check `Reminder.findUnique({ id }) === null OR deletedAt != null` → SKIPPED. |
| Workspace member removed | `ReminderRecipient` cascades. WORKSPACE-audience pending deliveries for that user are SKIPPED on dispatch (membership check). |
| dueAt postponed forward | Existing DELIVERED rows untouched. PENDING rows for offsets whose new `fireAt > now()` get `nextAttemptAt` updated; offsets whose `fireAt` is still in the past stay SKIPPED. |
| dueAt postponed backwards (validator prevents past) | Submission disabled. |
| Sync mutation fails (network) | Local state in Y.Doc preserved; next `editor.on('update')` retriggers debounced sync. The mutation is idempotent. |
| Two collaborators concurrently mutate the same chip | Y.Doc resolves attrs via CRDT; both clients eventually sync; last write wins on the server (the upsert is set-based, never accumulative). |
| WORKSPACE-audience reminder, new member added before fire time | Member is included on the next sync's `rebuildDeliveries` call (because the doc updates ≥ once between member-add and fire on a live page). Edge: if the doc isn't touched between member-add and fire, the new member is missed — accepted as a known limitation. |
| 50 reminders × 100 recipients × 6 offsets | 30k pending rows. `NotificationDelivery` already has `(status, nextAttemptAt)` partial-equivalent indexes from notifications/v1; verify during migration. `rebuildDeliveries` is idempotent so steady-state sync writes near-zero rows. |

## Testing

- **Unit** (vitest in `packages/editor`):
  - `computeReminderState` — all four colour transitions, boundary times,
    `doneAt`/`!dueAt` short-circuits.
  - `rebuildDeliveries` (in `packages/notifications`, mocked `prisma`) —
    audience resolution, idempotency, done-cancels-pending, postpone
    updates nextAttemptAt.
- **Integration** (vitest in `packages/trpc`):
  - `reminder.syncForPage` — upsert path, soft-delete path, undo-restore path
    (delete then re-include same UUID), permission denial, transaction
    atomicity (force-fail mid-loop, verify rollback).
- **Component** (vitest in `apps/web`):
  - `useReminderSync` — debounces, ignores placeholders, gates on
    `editor.isEditable`.
- **E2E** (playwright in `apps/e2e/reminders.spec.ts`):
  - Sign in via `signUpAndAuthAs`, create a page, run `/reminder`, fill the
    popover, verify chip appearance.
  - Set `dueAt` in the past via direct DB insert + page reload; assert chip
    renders red.
  - Toggle done → chip turns green; reopen popover → checkbox checked.
  - Postpone +1 day; assert new dueAt and DB pending deliveries reflect
    shifted `nextAttemptAt`.
  - Force-tick the dispatcher: in test setup, import `runDispatcherTick`
    from `@repo/notifications/worker` and call it directly against the test
    Prisma client. (No new scripts needed — this is the helper used by the
    existing notifier cron.) Verify the bell badge increments.

## Files touched / added

```
packages/db/prisma/
  schema.prisma                                          (M)
  migrations/<timestamp>_reminders/migration.sql         (A)

packages/notifications/src/
  catalog.ts                                             (M — REMINDER_DUE)
  reminders.ts                                           (A — rebuildDeliveries, cancelPendingDeliveries)

packages/mail/src/templates/
  reminder-due.ts                                        (A)

packages/trpc/src/routers/
  reminder.ts                                            (A)
  index.ts                                               (M — register reminder router)

packages/editor/src/extensions/
  reminder.schema.ts                                     (A)
  reminder.tsx                                           (A)
  reminder/state.ts                                      (A)
  reminder/colors.ts                                     (A)
  server.ts                                              (M — export ReminderSchema)
  index.ts                                               (M — include Reminder)

packages/editor/src/
  slash-items.ts                                         (M — new item)
  types.ts                                               (M — SlashItemHandlers extras)

apps/web/src/components/page/
  page-renderer.tsx                                      (M — wire useReminderSync, anchor scroll)
  reminder-popover.tsx                                   (A — single popover, create+edit modes)
  use-reminder-sync.ts                                   (A)

apps/web/src/components/page/editor-context.tsx           (M — openReminderCreate/Edit methods)

apps/e2e/
  reminders.spec.ts                                      (A)
```

## Migration steps

1. `pnpm --filter @repo/db exec prisma migrate dev --name reminders`
2. Add the `REMINDER_DUE` enum value to `NotificationEventType` (also a
   migration, sequentially).
3. No backfill — feature is additive; existing pages have no reminder nodes
   in their Y.Doc so the first sync is a no-op.

## Open questions

None at the time of writing. Recipient WORKSPACE-audience fan-out semantics
("members at fire time vs at create time") accepted as
"current-workspace-members at each `rebuildDeliveries` call".

## Out of scope (YAGNI)

- A workspace-wide "all my reminders" page (would be a follow-up if the
  inline-only model proves insufficient).
- Recurrence (`every Monday`).
- Free-form snooze with custom duration.
- Editing reminders from the bell popover.
- A dedicated `REMINDER` category in `NotificationCategory` (use
  `COLLABORATION`).
- Reminders for non-page entities (workspaces, chats).
