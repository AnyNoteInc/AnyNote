# Kanban enhancements: participants, sprint-aware add, avatars, bulk actions, label tags, status select

**Date:** 2026-06-03
**Status:** Approved (brainstorming complete, awaiting plan)

## Overview

Six independent enhancements to the Kanban page, sharing one new data-model
foundation (the participant model). In priority order of how they were
requested:

1. **Participants** — attach both unregistered named people (ФИО + company) and
   registered workspace users to tasks. Participants are unique per workspace,
   managed in a new Kanban-settings tab, and chosen from one merged searchable
   picker (workspace members first).
2. **Sprint-aware add** — adding a task from the board view places it in the
   sprint selected by the sprint filter (specific → that sprint, "Текущий" →
   ACTIVE sprint, "Все"/none → backlog).
3. **Avatars everywhere** — every place that shows an assignee renders the
   user's avatar image when set, falling back to initials.
4. **Bulk task actions** — a checkbox per task (board and table views), a
   bulk-action bar ("Удалить из спринта" / "Удалить"), and multi-drag that
   moves the whole selection together.
5. **Label tags on cards** — labels render in the card footer, right-aligned,
   left of the avatars, as solid color-background tags.
6. **Status select in the card dialog** — the card detail dialog header shows
   the current status (column) as a `<Select>`; changing it moves the task to
   that column.

## Background — current architecture (verified)

- **Assignees**: `TaskAssignee(taskId, userId)` → `User` directly. No concept of
  an unregistered participant. The picker (`task-form.tsx`) reads from
  `board.members` (workspace members only) as an inline checkbox list.
- **Labels**: `KanbanLabel(pageId, name, color)` (color required, hex from
  `KANBAN_LABEL_COLOR_HEXES`); attached via `KanbanLabelOnTask`. Label CRUD is
  tRPC-only (`kanban.label`), task↔label via `kanban.task.setLabels`. On cards,
  labels currently render as outlined chips at the **top** of the card
  (`board-card.tsx`).
- **Sprints**: "current" = the single `Sprint` with `status='ACTIVE'`
  (one-active-per-page invariant). Backlog = `Task.sprintId === null`.
  `createTask` **already accepts** an optional `sprintId`. Board "Add card"
  currently never passes it (always backlog); table/sprint view does.
- **Status**: implicit via `Task.columnId` (columns have `kind`
  ACTIVE/DONE/CANCELLED). The card dialog shows the column **title** as
  read-only text.
- **DnD**: `@hello-pangea/dnd`. `handleDragEnd` (`board-view.tsx`) moves **one**
  task: computes `positionBetween`, optimistic `setData`, then
  `moveTask.mutateAsync({ targetColumnId, beforeId, afterId })`.
- **Avatars**: app standard is MUI `<Avatar src={user.image}>` (e.g.
  `share-dialog.tsx`); Kanban's `assignee-avatars.tsx` is a custom
  initials-only circle with **no** image support. `getBoard` does **not** select
  `user.image` for members or assignees.
- **`initials()` helper** exists at `task-side-panel.tsx:54` (first of firstName
  ∥ email, plus first of lastName, uppercased).
- **Domain layer**: `packages/domain/src/kanban` holds task/sprint/assignee
  writes as `fn(actorUserId, input)` throwing `DomainError`; tRPC wraps via
  `mapDomain`. `setTaskAssignees` takes `{ pageId, id, userIds }`.
- **`softDelete`** (`kanban.task`) is single-id, gated creator-or-OWNER.

## Data model

### New: `WorkspaceParticipant`

The unified assignable-person record. Every assignee — registered or guest — is
a participant. A registered user's participant row is created lazily
(auto-mirror) the first time they are assigned.

```prisma
model WorkspaceParticipant {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  userId      String?  @map("user_id") @db.Uuid   // null = guest; set = mirrors a registered user
  fullName    String   @db.VarChar(64)            // ФИО, ≤64
  company     String?  @db.VarChar(64)            // company, ≤64
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  workspace Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User?          @relation(fields: [userId], references: [id], onDelete: Cascade)
  tasks     TaskAssignee[]

  @@unique([workspaceId, userId])   // at most one mirror row per user per workspace
  @@index([workspaceId])
  @@map("workspace_participants")
}
```

Add the back-relations: `Workspace.participants WorkspaceParticipant[]` and
`User.workspaceParticipants WorkspaceParticipant[]`.

> Note on the unique constraint: `@@unique([workspaceId, userId])` permits many
> rows with `userId = null` (guests) in the same workspace — Postgres treats
> NULLs as distinct in a unique index — and at most one mirror row per real
> user per workspace. This is the intended behavior.

### Changed: `TaskAssignee` repointed to `participantId`

```prisma
model TaskAssignee {
  taskId        String   @map("task_id") @db.Uuid
  participantId String   @map("participant_id") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at")

  task        Task                 @relation(fields: [taskId], references: [id], onDelete: Cascade)
  participant WorkspaceParticipant @relation(fields: [participantId], references: [id], onDelete: Cascade)

  @@id([taskId, participantId])
  @@index([participantId])
  @@map("task_assignees")
}
```

Drop the old `userId` column and its `User` relation. Update `User` to remove
the now-dead `TaskAssignee` relation (assignees reach `User` only through
`participant.user`).

### Migration (data-preserving)

A single Prisma migration whose `migration.sql` is hand-edited to interleave
schema DDL with a raw-SQL data step (not a separate script), executed in this
order:

1. Create `workspace_participants`.
2. Add nullable `participant_id` to `task_assignees`.
3. For each existing `task_assignees(task_id, user_id)`:
   - resolve the task's workspace via `task → page → workspace`;
   - find-or-create `workspace_participants(workspace_id, user_id)` with
     `full_name` = `"<firstName> <lastName>"`.trim() ∥ `email`, `company = null`;
   - set `participant_id` on the assignee row.
4. Drop the old PK `(task_id, user_id)`, drop `user_id`, make `participant_id`
   NOT NULL, add the new PK `(task_id, participant_id)` and index.

No assignment is lost. A migration test asserts pre/post assignee counts per
task are equal and that every new row resolves to a participant whose
`userId` matches the original.

## Domain & tRPC layer

### Domain — `packages/domain/src/kanban`

New participant operations (participants are write logic, so they live in the
domain alongside `setTaskAssignees`):

- `createParticipant(actorUserId, { workspaceId, fullName, company })` — creates
  a pure guest (`userId = null`). Validates `fullName` 1–64, `company` ≤64
  (Zod). Returns the row.
- `updateParticipant(actorUserId, { id, fullName, company })` — **guest-only**:
  throws `DomainError` (code `PARTICIPANT_NOT_EDITABLE`, httpStatus 409) if the
  row has `userId != null`.
- `deleteParticipant(actorUserId, { id })` — **guest-only** (same guard);
  cascade removes its `TaskAssignee` rows via FK.
- `findOrCreateUserParticipant(prisma, workspaceId, userId)` — the lazy
  auto-mirror; idempotent on `(workspaceId, userId)`. Pulls `fullName` from the
  user profile at creation time.

`setTaskAssignees` is reworked to a mixed input:

```ts
setTaskAssignees(actorUserId, {
  pageId, id,                  // task
  participantIds: string[],    // existing participants (guests or already-mirrored users)
  userIdsToMirror: string[],   // workspace users not yet mirrored → find-or-create then assign
})
```

It resolves `userIdsToMirror` to participant rows (find-or-create), unions with
`participantIds`, diffs against current assignees, and applies add/remove —
keeping the ASSIGNED/UNASSIGNED activity log (now keyed by participant). All
participant ids are validated to belong to the page's workspace.

DTOs (`dto/kanban.dto.ts`): `createParticipantInput`, `updateParticipantInput`,
`participantIdInput`, and the new `setTaskAssigneesInput` shape. Authorization
reuses the existing page/workspace access checks used by other kanban writes.

### tRPC

- New sub-router `kanban.participant`: `list`, `create`, `update`, `delete`
  (each `mapDomain`-wrapped, except `list` which is a direct query of guests +
  the merge happens in `getBoard`).
- `kanban.task.setAssignees` input changes to the new mixed shape.
- New `kanban.task.bulkSoftDelete({ pageId, ids })` — applies the existing
  per-task creator-or-OWNER permission check to each id, **skips** ids the actor
  may not delete (does not fail the batch), soft-deletes the rest, emits one
  `task.deleted` per deleted id, and returns `{ deletedIds }` so the client
  reconciles.

### `getBoard` query changes

- Add `image: true` to every `user` select (members **and**
  assignee→participant→user). Needed for avatars (#3).
- Include the workspace's guest `participants` (for the picker).
- Task `assignees` now include `participant` (with optional linked `user`),
  replacing the old direct `user` include.

## UI

### #1 Participant picker (`participant-picker.tsx`, used by `task-form.tsx`)

Replaces the inline member checkbox-list with the approved **chips-on-top +
search-below** layout:

- Selected participants render as removable chips at the top (avatar + name + ✕).
- A search field filters across **workspace members** (shown first, with a
  "в пространстве" badge) and **guest participants** below.
- Typing a name with no match shows a "＋ Создать гостя «…»" row → inline form
  (ФИО ≤64, Компания ≤64) → creates the guest and assigns it.
- Selecting an un-mirrored member adds its id to `userIdsToMirror`; selecting an
  existing participant adds its `participantId`. The save calls
  `kanban.task.setAssignees` with both arrays.

### #3 Avatars everywhere (`participant-avatar.tsx` / upgraded `assignee-avatars.tsx`)

A shared avatar component on MUI `<Avatar src={user?.image ?? undefined}>` with
the existing `initials()` fallback. Guests (no `userId`/no `user`) always show
initials. Applied to: board cards, task-form chips, picker rows/chips,
side-panel activity, table view. Requires the `image` select from the
`getBoard` change.

### #5 Labels in card footer (`board-card.tsx`)

Remove the top outlined label chips. Render labels as **solid
color-background** tags in the card's bottom row, right-aligned, immediately
left of the avatars: `[dates … ][labels][avatars]`. Overflow collapses to "+N"
(reuse the existing `board-card-model.ts` visible/hidden split).

### #6 Status select (`task-form.tsx` / `task-detail-modal.tsx`)

Replace the read-only column-title text in the dialog header with a MUI
`<Select>` whose options are the board's columns (color dot + title), value =
the task's current `columnId`. Changing it calls `kanban.task.move` to the
chosen column (appended to end, `beforeId`/`afterId` resolved from that
column's current tasks), changing the task's status.

### #2 Sprint-aware add (`board-column.tsx`)

The board "Add card" commit derives a `sprintId` from the current sprint filter
(via `useKanbanFilters` / board page) using a pure helper:

```
filter = specific sprint id → that id
filter = "current"          → the ACTIVE sprint's id (or undefined if none)
filter = "all" / no active  → undefined (backlog)
```

`createTask` already accepts `sprintId`; this is frontend-only wiring plus the
pure resolver (unit-tested).

### #4 Bulk selection + multi-drag (board **and** table views)

- A page-scoped selection store (React context holding `Set<taskId>`). Each
  card/row gets a checkbox, visible on hover or whenever the selection is
  non-empty.
- When ≥1 task is selected, a sticky bottom **bulk-action bar** appears:
  `N выбрано · [Удалить из спринта] [Удалить] [✕ снять выделение]`.
  - **Удалить из спринта** → `task.update({ sprintId: null })` per selected task
    (batched client-side).
  - **Удалить** → `task.bulkSoftDelete({ pageId, ids })` behind a confirm
    dialog.
- **Multi-drag**: in `handleDragEnd`, if the dragged task is in the selection,
  move **all** selected tasks to the drop column — contiguous, stacked at the
  drop position — via batched `moveTask` calls and one optimistic `setData`. The
  `<Draggable>` render shows a count badge ("×N") while dragging a selected
  card. Selection clears after drop. If the dragged card is **not** selected,
  behavior is unchanged (single drag). Same-column multi-drag reorders the
  contiguous selection at the drop point.

### Settings — new "Участники" tab (`kanban-settings-dialog.tsx`)

A 5th tab after `[Типы, Приоритеты, Метки, Статусы]`. Not a `SortableList`
(participants aren't ordered):

- Workspace members listed read-only at top (avatar + name + "в пространстве"
  badge), not deletable here.
- Guest participants below, each editable inline (ФИО, Компания) and deletable
  (confirm if assigned to tasks — deletion cascades the assignment).
- An "＋ Добавить участника" form (ФИО ≤64, Компания ≤64).

Backed by `kanban.participant.{list,create,update,delete}`.

## Edge cases / decisions

- Deleting a guest cascades its `TaskAssignee` rows (FK `onDelete: Cascade`);
  the settings tab warns before deleting an assigned guest.
- A user who **leaves** the workspace keeps their mirror participant row (FK
  cascade is on user *deletion*, not membership change). Existing assignments
  survive; the picker simply won't list them as a current member.
- `bulkSoftDelete` skips ids the actor can't delete rather than failing the
  whole batch; returns `deletedIds` for client reconciliation.
- Multi-drag within the same column reorders the contiguous selection at the
  drop point.

## Testing

- **Domain unit tests** (`@repo/domain`, vitest): `createParticipant` length
  validation; `updateParticipant`/`deleteParticipant` reject guest-only
  violations (`userId` set); `findOrCreateUserParticipant` idempotency;
  `setTaskAssignees` mixed-input (participantIds + userIdsToMirror) diff.
- **tRPC tests**: `kanban.participant` CRUD; `bulkSoftDelete` permission
  filtering (creator vs OWNER vs other → correct `deletedIds`).
- **Migration test**: existing assignees backfill into participants with
  per-task count preserved and `userId` correspondence.
- **Component / pure-function tests** (vitest, node env where feasible): the
  sprint-resolution helper for #2; the label-footer visible/hidden model; the
  status-select option mapping; the selection-store reducer.
- **Manual browser verification** (per the repo's DnD/Yjs "verify in real app"
  convention): multi-drag with the count badge, the live participant picker
  (search across members + guests, create-guest flow), avatars rendering from
  `user.image`. `@hello-pangea/dnd` is not reliably unit-testable.

## Out of scope

- Inviting a guest to actually register / linking a guest to a later-created
  account (no guest→user promotion flow).
- Participant avatars for guests (guests show initials only; no guest image
  upload).
- Bulk actions beyond "Удалить из спринта" and "Удалить" (e.g. bulk assignee /
  label / move-to-sprint) — not requested.
- Changing the sprint-filter semantics themselves; #2 only reads them.
