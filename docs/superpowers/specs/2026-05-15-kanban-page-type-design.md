# Kanban Page Type — Design Spec

**Date:** 2026-05-15
**Status:** Draft, awaiting user review
**Scope:** Introduce a new `KANBAN` page type alongside `TEXT`, `EXCALIDRAW`, `GENOGRAM`. A board manages columns, tasks, sprints, labels, types, priorities, comments, attachments, and activity in three switchable views (board / table / gantt). Per-page settings (configurable types, labels, priorities, statuses) are sortable via drag-and-drop. Realtime updates without page reload via tRPC v11 SSE subscriptions. Permissions inherit from workspace membership; per-page settings restricted to page creator or workspace OWNER.

---

## 1. Goals & Non-goals

### Goals

- Users create a KANBAN page from the workspace tree the same way they create TEXT/EXCALIDRAW pages.
- Three switchable views — **Board** (column DnD via `@hello-pangea/dnd`), **Table** (backlog + sprint sections), **Gantt** (`gantt-task-react`).
- Per-board configurable Types, Priorities, Labels, Statuses (columns); all sortable via DnD; settings live in a modal opened from the page "⋯" menu.
- Optional Sprints per board with a hard constraint of one `ACTIVE` sprint at a time.
- Filters by Sprint / Assignee / Dates / Labels apply to all views.
- Tasks support: title, Tiptap description, assignees, labels, type, priority, sprint, parent (dependency), start date, due date, archive, soft-delete, attachments, comments, activity log.
- Realtime: any user's mutation propagates to every connected client of the same page without refresh.
- Cascade delete: hard-delete of the Page wipes all kanban data via FK `onDelete: Cascade`.

### Non-goals (this spec)

- Yjs collaborative editing inside the card description editor — `Task.description` is plain Tiptap JSON, save-on-blur via tRPC.
- Workspace-level (cross-board) types / priorities / labels — strictly per-board.
- Multi-user presence cursors inside a card.
- Vectorization of task content for AI search (no `outbox` writes for Task entities; can be added later without schema changes).
- Bulk operations (multi-select cards, bulk move, bulk label).
- Import/export from Trello / Jira / Linear.
- Lightweight per-card checklist items (`TaskChecklistItem`). Sub-tasks are modelled via `Task.parentId` only.

---

## 2. Architecture Overview

```
Browser
  apps/web  /workspaces/{wsId}/pages/{pageId}
    └─ <PageRenderer page={page}>
         └─ type=KANBAN → <KanbanBoardPage pageId/>   (next/dynamic ssr:false)

Browser ↔ apps/web (HTTP, existing /api/trpc/[trpc] route, nodejs runtime)
  tRPC kanban router:
    queries:      board.getBoard, board.getTask, board.getActivity,
                  comment.list, attachment.list
    mutations:    column/type/priority/label CRUD + reorder,
                  sprint CRUD + activate/complete,
                  task CRUD + move + setAssignees + setLabels + archive + restore,
                  comment CRUD, attachment presign/finalize/delete
    subscriptions: events.subscribe({ pageId })   (SSE via httpSubscriptionLink)

Postgres (single source of truth)
  All kanban entities are tables; FK on Page with onDelete: Cascade.

Realtime bus
  In-memory EventEmitter keyed by pageId (single Next.js instance, current prod).
  Phase P4 adds Postgres LISTEN/NOTIFY layer for multi-instance.
```

**Key invariants:**

- All kanban entities (`KanbanColumn`, `KanbanType`, `KanbanPriority`, `KanbanLabel`, `Sprint`, `Task`, ...) FK to `Page.id` with `onDelete: Cascade`. `page.hardDelete` wipes everything; `page.softDelete` only sets `Page.deletedAt`, kanban data remains.
- Exactly one `Sprint` per `Page` may have `status=ACTIVE`. Enforced by a Postgres partial unique index added via raw SQL in the migration.
- `Task.columnId` is `NOT NULL`. When a column is deleted, all its tasks are moved to the first remaining column in the same transaction. The user-facing rule "статус задачи прикрепляются к первой колонке".
- `KanbanType`, `KanbanPriority`, `KanbanLabel` FKs on Task use `onDelete: SetNull`. When `task.create` omits type/priority, the first record by `position ASC` is selected ("по умолчанию первый пункт").
- Position fields on all sortable entities (`Task.position`, `Task.sprintPosition`, `KanbanColumn.position`, `KanbanType.position`, etc.) are `Float`. New insertion takes `(prev.position + next.position) / 2`. Background rebalance runs in the same mutation if the gap drops below `Number.EPSILON * 1024`.
- Realtime echo events from a client's own mutations are still delivered to that client; React Query cache patches are idempotent.

---

## 3. Data Model (Prisma)

All changes in `packages/db/prisma/schema.prisma`. One migration `<timestamp>_kanban_initial.sql` for P1 creates all tables, enums, and the partial unique index.

### Enums

```prisma
enum KanbanColumnKind {
  ACTIVE      // default; tasks in these columns are "open"
  DONE        // tasks are considered closed
  CANCELLED   // hidden from table/gantt views by default
}

enum SprintStatus {
  PLANNED
  ACTIVE
  COMPLETED
}

enum TaskActivityType {
  CREATED
  MOVED                  // column change
  STATUS_CHANGED         // emitted in addition to MOVED when column.kind changes
  PRIORITY_CHANGED
  TYPE_CHANGED
  ASSIGNED
  UNASSIGNED
  LABELED
  UNLABELED
  RENAMED
  DESCRIPTION_CHANGED
  DUE_DATE_CHANGED
  START_DATE_CHANGED
  SPRINT_CHANGED
  PARENT_CHANGED
  ARCHIVED
  UNARCHIVED
  ATTACHMENT_ADDED
  ATTACHMENT_REMOVED
  COMMENTED
}
```

### Page-bound settings (per-board)

```prisma
model KanbanColumn {
  id        String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId    String           @map("page_id") @db.Uuid
  title     String
  kind      KanbanColumnKind @default(ACTIVE)
  position  Float
  color     String?
  createdAt DateTime         @default(now()) @map("created_at")
  updatedAt DateTime         @updatedAt @map("updated_at")

  page  Page   @relation(fields: [pageId], references: [id], onDelete: Cascade)
  tasks Task[]

  @@index([pageId, position])
  @@map("kanban_columns")
}

model KanbanType {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId    String   @map("page_id") @db.Uuid
  title     String
  position  Float
  color     String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  page  Page   @relation(fields: [pageId], references: [id], onDelete: Cascade)
  tasks Task[]

  @@index([pageId, position])
  @@map("kanban_types")
}

model KanbanPriority {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId    String   @map("page_id") @db.Uuid
  title     String
  position  Float
  color     String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  page  Page   @relation(fields: [pageId], references: [id], onDelete: Cascade)
  tasks Task[]

  @@index([pageId, position])
  @@map("kanban_priorities")
}

model KanbanLabel {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId    String   @map("page_id") @db.Uuid
  name      String
  color     String                                                    // hex from fixed palette, validated in API
  position  Float
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  page  Page                @relation(fields: [pageId], references: [id], onDelete: Cascade)
  tasks KanbanLabelOnTask[]

  @@unique([pageId, name])
  @@index([pageId, position])
  @@map("kanban_labels")
}
```

### Sprints

```prisma
model Sprint {
  id          String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId      String       @map("page_id") @db.Uuid
  name        String
  description String?      @db.Text
  startDate   DateTime?    @map("start_date")
  endDate     DateTime?    @map("end_date")
  status      SprintStatus @default(PLANNED)
  position    Float
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")

  page  Page   @relation(fields: [pageId], references: [id], onDelete: Cascade)
  tasks Task[]

  @@index([pageId, status])
  @@map("sprints")
}
```

Raw SQL appended to the migration:

```sql
CREATE UNIQUE INDEX sprint_one_active_per_page
  ON sprints (page_id)
  WHERE status = 'ACTIVE';
```

### Tasks

```prisma
model Task {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId         String   @map("page_id") @db.Uuid                 // denormalized; queries filter by pageId
  columnId       String   @map("column_id") @db.Uuid               // NOT NULL; column.delete reassigns to first
  typeId         String?  @map("type_id") @db.Uuid
  priorityId    String?   @map("priority_id") @db.Uuid
  sprintId       String?  @map("sprint_id") @db.Uuid
  parentId       String?  @map("parent_id") @db.Uuid               // self-FK for dependency
  title          String
  description    Json?                                              // Tiptap JSON
  startDate      DateTime? @map("start_date")
  dueDate        DateTime? @map("due_date")
  position       Float                                              // within column
  sprintPosition Float?    @map("sprint_position")                  // within sprint section in table view
  archived       Boolean   @default(false)
  deletedAt      DateTime? @map("deleted_at")
  createdById    String    @map("created_by_id") @db.Uuid
  updatedById    String?   @map("updated_by_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  page       Page             @relation(fields: [pageId], references: [id], onDelete: Cascade)
  column     KanbanColumn     @relation(fields: [columnId], references: [id], onDelete: Restrict)
  type       KanbanType?      @relation(fields: [typeId], references: [id], onDelete: SetNull)
  priority   KanbanPriority?  @relation(fields: [priorityId], references: [id], onDelete: SetNull)
  sprint     Sprint?          @relation(fields: [sprintId], references: [id], onDelete: SetNull)
  parent     Task?            @relation("TaskHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children   Task[]           @relation("TaskHierarchy")
  createdBy  User             @relation("TaskCreator", fields: [createdById], references: [id])
  updatedBy  User?            @relation("TaskUpdater", fields: [updatedById], references: [id])

  assignees   TaskAssignee[]
  labels      KanbanLabelOnTask[]
  comments    TaskComment[]
  activity    TaskActivity[]
  attachments TaskAttachment[]

  @@index([pageId, columnId, position])
  @@index([pageId, sprintId])
  @@index([pageId, deletedAt, archived])
  @@map("tasks")
}

model TaskAssignee {
  taskId    String   @map("task_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([taskId, userId])
  @@index([userId])
  @@map("task_assignees")
}

model KanbanLabelOnTask {
  taskId  String @map("task_id") @db.Uuid
  labelId String @map("label_id") @db.Uuid

  task  Task        @relation(fields: [taskId], references: [id], onDelete: Cascade)
  label KanbanLabel @relation(fields: [labelId], references: [id], onDelete: Cascade)

  @@id([taskId, labelId])
  @@index([labelId])
  @@map("kanban_labels_on_tasks")
}

model TaskComment {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId    String    @map("task_id") @db.Uuid
  authorId  String    @map("author_id") @db.Uuid
  content   Json                                                    // Tiptap-lite JSON
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  author User @relation(fields: [authorId], references: [id])

  @@index([taskId, createdAt])
  @@map("task_comments")
}

model TaskActivity {
  id        String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId    String           @map("task_id") @db.Uuid
  actorId   String           @map("actor_id") @db.Uuid
  type      TaskActivityType
  payload   Json?                                                   // { fromId, toId, fromValue, toValue, ... }
  createdAt DateTime         @default(now()) @map("created_at")

  task  Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actor User @relation(fields: [actorId], references: [id])

  @@index([taskId, createdAt])
  @@map("task_activity")
}

model TaskAttachment {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  taskId       String    @map("task_id") @db.Uuid
  uploadedById String    @map("uploaded_by_id") @db.Uuid
  fileName     String    @map("file_name")
  mimeType     String    @map("mime_type")
  size         BigInt
  storageKey   String    @map("storage_key")
  finalizedAt  DateTime? @map("finalized_at")                       // null until client confirms PUT succeeded
  createdAt    DateTime  @default(now()) @map("created_at")
  deletedAt    DateTime? @map("deleted_at")

  task       Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  uploadedBy User @relation(fields: [uploadedById], references: [id])

  @@index([taskId, createdAt])
  @@map("task_attachments")
}
```

### Page / User reverse relations

Add to existing `Page` model:

```prisma
kanbanColumns    KanbanColumn[]
kanbanTypes      KanbanType[]
kanbanPriorities KanbanPriority[]
kanbanLabels     KanbanLabel[]
sprints          Sprint[]
tasks            Task[]
```

Add to existing `User` model:

```prisma
tasksCreated     Task[]           @relation("TaskCreator")
tasksUpdated     Task[]           @relation("TaskUpdater")
taskAssignments  TaskAssignee[]
taskComments     TaskComment[]
taskActivity     TaskActivity[]
taskAttachments  TaskAttachment[]
```

### Seed on page creation

When `page.create` is called with `type=KANBAN`, a follow-up transaction seeds:

- 3 columns: `Todo` (ACTIVE, position=1), `In Progress` (ACTIVE, position=2), `Done` (DONE, position=3)
- 2 types: `Задача` (position=1), `Баг` (position=2)
- 5 priorities: `Highest`, `High`, `Medium`, `Low`, `Lowest` (positions 1-5)
- 0 labels (user adds them as needed)
- 0 sprints

Seed runs inside the same Postgres transaction as `page.create` so that a partial KANBAN page is impossible.

---

## 4. tRPC API + Realtime

### Router layout

New file `packages/trpc/src/routers/kanban.ts` aggregates sub-routers. Each sub-router is its own file under `packages/trpc/src/routers/kanban/` to keep file sizes manageable:

- `kanban/board.ts` — `getBoard`, `getTask`, `getActivity`
- `kanban/column.ts` — `create`, `update`, `reorder`, `delete`
- `kanban/type.ts` — `create`, `update`, `reorder`, `delete`
- `kanban/priority.ts` — `create`, `update`, `reorder`, `delete`
- `kanban/label.ts` — `create`, `update`, `reorder`, `delete`
- `kanban/sprint.ts` — `create`, `update`, `activate`, `complete`, `reorder`, `delete`
- `kanban/task.ts` — `create`, `update`, `move`, `setAssignees`, `setLabels`, `archive`, `unarchive`, `softDelete`, `restore`, `hardDelete`
- `kanban/comment.ts` — `list`, `create`, `update`, `delete`
- `kanban/attachment.ts` — `list`, `presignUpload`, `finalize`, `delete`
- `kanban/events.ts` — `subscribe` (SSE)

Mounted as `kanban: t.router({ board, column, type, priority, label, sprint, task, comment, attachment, events })`.

### Notable procedures

```ts
board.getBoard({ pageId })   →  {
  columns:    KanbanColumn[]
  types:      KanbanType[]
  priorities: KanbanPriority[]
  labels:     KanbanLabel[]
  sprints:    Sprint[]            // all sprints; activeSprintId derivable
  tasks:      TaskWithRelations[] // not deletedAt, not archived
  members:    WorkspaceMember[]
}

board.getTask({ taskId })    →  Task + assignees + labels + parent + children[] + attachments + recentActivity[10]
board.getActivity({ taskId, cursor })  →  TaskActivity[] (infinite scroll)

column.delete({ id })        →  TX: tasks.updateMany({ columnId: id }, { columnId: firstRemaining.id }); column.delete(id)
                                Errors: BAD_REQUEST if this is the last column.

sprint.activate({ id })      →  TX: update sprints set status=PLANNED where pageId=$p and status=ACTIVE;
                                    update sprints set status=ACTIVE where id=$id.
                                Errors: CONFLICT on partial unique index violation (race condition).

task.create({ pageId, columnId?, typeId?, priorityId?, sprintId?, parentId?, title, ... })
                              →  If columnId omitted, picks first column by position ASC.
                                 If typeId/priorityId omitted, picks first by position ASC.
                                 Writes TaskActivity { type: CREATED }.

task.move({ id, targetColumnId, before?, after? })
                              →  TX: update columnId + position = mid(before, after);
                                  insert TaskActivity { MOVED, payload: { fromColumnId, toColumnId } };
                                  if columns have different `kind`, also insert STATUS_CHANGED.

task.setAssignees({ taskId, userIds[] })
                              →  TX: diff against current; insert/delete TaskAssignee rows;
                                 insert ASSIGNED/UNASSIGNED activity per delta.

task.setLabels({ taskId, labelIds[] })
                              →  Same pattern: diff + LABELED/UNLABELED.

attachment.presignUpload({ taskId, fileName, mimeType, size })
                              →  Validates size ≤ STORAGE_MAX_FILE_BYTES and mimeType against whitelist.
                                 Creates TaskAttachment row with finalizedAt=null.
                                 Returns { id, uploadUrl, expiresAt }.

attachment.finalize({ id })   →  Verifies object exists in MinIO via HEAD;
                                 sets finalizedAt = now();
                                 emits 'task.updated' event.
```

Cleanup of unfinalized `TaskAttachment` rows older than 24h runs as a cron in `apps/engines` (new module `apps/engines/src/apps/kanban-cleanup/`). MinIO objects without a corresponding row are not actively pruned (acceptable; bucket lifecycle policy handles it).

### Realtime: tRPC v11 SSE subscriptions

**Client** (`apps/web/src/trpc/client.tsx`): inject `httpSubscriptionLink` via `splitLink`:

```ts
splitLink({
  condition: (op) => op.type === 'subscription',
  true:  httpSubscriptionLink({ url: '/api/trpc' }),
  false: httpBatchLink({ url: '/api/trpc' }),
})
```

Existing route `apps/web/src/app/api/trpc/[trpc]/route.ts` handles SSE automatically through tRPC's `fetchRequestHandler` returning a `ReadableStream`. Runtime stays `nodejs`.

**Server** — single subscription procedure:

```ts
events.subscribe({ pageId })  →  AsyncIterable<KanbanEvent>

type KanbanEvent =
  | { kind: 'task.created'   | 'task.updated' | 'task.deleted' | 'task.moved'; taskId: string }
  | { kind: 'column.upserted' | 'column.deleted'; columnId: string }
  | { kind: 'sprint.upserted' | 'sprint.deleted'; sprintId: string }
  | { kind: 'comment.upserted' | 'comment.deleted'; taskId: string; commentId: string }
  | { kind: 'settings.upserted'; entity: 'type' | 'priority' | 'label' }
  | { kind: 'activity.appended'; taskId: string }
```

Resolver flow:
1. `assertPageAccess(pageId)` on connect (rejects non-members with `FORBIDDEN`).
2. Subscribes to `bus.on(pageId, callback)`.
3. Yields events forever; on client disconnect, runs `bus.off(pageId, callback)`.

**Transport** — `packages/trpc/src/realtime/kanban-bus.ts`:

```ts
class KanbanBus {
  emit(pageId: string, event: KanbanEvent): void
  on(pageId: string, listener: (e: KanbanEvent) => void): () => void  // returns unsubscribe
}

export const kanbanBus = new KanbanBus()
```

Implementation in P1: in-memory `Map<pageId, Set<listener>>`. All mutations import `kanbanBus` and call `kanbanBus.emit(pageId, event)` AFTER the transaction commits (so subscribers don't read stale data).

In P4 we add `packages/trpc/src/realtime/kanban-bus-postgres.ts` that wraps in-memory bus with Postgres `LISTEN/NOTIFY` on channel `kanban_events`. A dedicated `pg` client (separate connection, not from Prisma pool) listens; mutations append `NOTIFY kanban_events, $json` to the transaction. Each Next.js process rebroadcasts to its local bus. Swap-in is transparent to mutation/subscription code.

### Optimistic updates

DnD on Board view applies `setQueryData` patch BEFORE `task.move` is called. On error, rollback restores prior cache state. Server SSE echo confirms (idempotent patch). This eliminates the 100-300 ms drag-drop latency.

---

## 5. UI Architecture

### Entry points (existing files to modify)

- `apps/web/src/components/page/page-renderer.tsx` — add branch:

  ```tsx
  if (page.type === 'KANBAN') {
    return <KanbanBoardPage pageId={page.id} workspaceId={page.workspaceId} />
  }
  ```

  `KanbanBoardPage` is `next/dynamic({ ssr: false })`.

- `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx` — extend `isFullBleed`:

  ```ts
  const isFullBleed = page.type === 'EXCALIDRAW' || page.type === 'GENOGRAM' || page.type === 'KANBAN'
  ```

- `apps/web/src/components/workspace/page-tree-section.tsx` — extend `CreatablePageType` to include `'KANBAN'`; add `ViewKanbanIcon` menu entry labelled "Канбан".

- `packages/ui/src/components/index.ts` — re-export `ViewKanbanIcon` from `@mui/icons-material/ViewKanban`.

- `packages/trpc/src/routers/page.ts` — extend `page.create` to seed default kanban entities when `type === 'KANBAN'`.

### New component tree

```
apps/web/src/components/kanban/
├── kanban-board-page.tsx           # Top-level: getBoard, mount events sub, hold view+filter state
├── kanban-toolbar.tsx              # icon + title + Create Task + view switcher
├── kanban-filters.tsx              # Sprint / User / Dates / Labels chips
├── views/
│   ├── board-view.tsx              # DragDropContext + columns
│   ├── board-column.tsx            # Droppable column body
│   ├── board-card.tsx              # Draggable card preview
│   ├── table-view.tsx              # Sprint sections + backlog
│   ├── sprint-section.tsx          # Sprint header + droppable list
│   ├── table-row.tsx
│   ├── gantt-view.tsx              # gantt-task-react integration
├── task/
│   ├── task-detail-container.tsx   # Reads ?taskId / ?panel from URL
│   ├── task-detail-modal.tsx       # MUI Dialog
│   ├── task-detail-panel.tsx       # MUI Drawer (anchor=right, width=560)
│   ├── task-form.tsx               # Shared form body
│   ├── task-description-editor.tsx # Tiptap-lite (StarterKit + Link)
│   ├── task-comments.tsx
│   ├── task-activity-list.tsx
│   ├── task-attachments.tsx
│   └── pickers/                    # AssigneePicker, LabelsPicker, PriorityPicker, ...
├── sprint/
│   ├── sprint-create-dialog.tsx
│   ├── sprint-card.tsx
├── settings/
│   ├── kanban-settings-dialog.tsx  # Tabs: Types / Labels / Priorities / Statuses
│   ├── sortable-list.tsx           # Reusable DnD list (used by all 4 tabs)
└── realtime/
    └── use-kanban-events.ts        # SSE hook; patches React Query cache
```

### State & URL

- `?view=board|table|gantt` — view selector persists in URL.
- `?sprint=current|all|<ids>` — sprint filter.
- `?users=<ids>` — assignee filter.
- `?from=<date>&to=<date>&overdue=1` — date filter.
- `?labels=<ids>` — label filter.
- `?taskId=<uuid>` — opens detail modal.
- `?taskId=<uuid>&panel=1` — opens detail drawer instead of modal.

Filters applied client-side against `board.getBoard` snapshot in `apps/web/src/components/kanban/filters/apply-filters.ts` (pure function, unit-tested).

### Drag-and-drop

`@hello-pangea/dnd` added to `apps/web/package.json` dependencies. Single root `<DragDropContext>` per view; `onDragEnd` dispatches the appropriate `task.move` / `task.reorder` / `column.reorder` / `sprint.reorder` mutation with optimistic cache patch.

Settings dialog reuses `sortable-list.tsx` for all 4 tabs (types / labels / priorities / statuses).

### Gantt

`gantt-task-react` added to `apps/web/package.json`. Tasks without `startDate` are hidden with a hint "set dates to view in Gantt". Custom `TaskListTable` renders columns: Title, Assignees (avatar group with tooltip), Start, End. `onDateChange` → `task.update`. `onClick` → push `?taskId=...`.

### Task detail UX

- Default `?taskId=<uuid>` → `TaskDetailModal` (MUI Dialog, `maxWidth="md"`).
- "↗ Open in panel" button → push `?taskId=...&panel=1` → close modal, open `TaskDetailPanel` (right-anchored MUI Drawer). Board remains interactive on the left.
- Shared `TaskForm` renders inside both. Save-on-blur per field via `task.update`. Title debounced 800 ms or on blur. Description (Tiptap) saved on blur.

### Label palette

Fixed 9-color palette stored in `packages/ui/src/lib/kanban-colors.ts`:

```ts
export const KANBAN_LABEL_COLORS = [
  { name: 'red',    hex: '#EF4444' },
  { name: 'orange', hex: '#F97316' },
  { name: 'yellow', hex: '#EAB308' },
  { name: 'green',  hex: '#22C55E' },
  { name: 'teal',   hex: '#14B8A6' },
  { name: 'blue',   hex: '#3B82F6' },
  { name: 'purple', hex: '#A855F7' },
  { name: 'pink',   hex: '#EC4899' },
  { name: 'gray',   hex: '#6B7280' },
]
```

Both client picker and `label.create` mutation validate `color` belongs to this set.

---

## 6. Cross-cutting

### Sprints

- New sprints default to `PLANNED` (not active).
- Activation: `sprint.activate({ id })` atomically demotes the previous `ACTIVE` to `PLANNED` and promotes the target.
- Completion: `sprint.complete({ id })` sets `status = COMPLETED`. Tasks retain their `sprintId`; the "current sprint" filter no longer matches them.
- On board open: if a sprint is `ACTIVE`, filter `?sprint=current` is applied by default. If sprints exist but none active, default is `?sprint=all`. If no sprints exist at all, the Sprint filter chip is hidden.
- Backlog (in table view): tasks with `sprintId = null` in their own collapsible section below the sprint list.

### Filters

| Filter   | UX                                                                    | URL                            | Predicate                                                            |
| -------- | --------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| Sprint   | Radio current/all + checkboxes for past; hidden if no sprints         | `sprint=current\|all\|<ids>`   | `task.sprintId` matches                                              |
| User     | Checkbox list of workspace members; selected shown as tag chips       | `users=<ids>`                  | `task.assignees ∩ selected ≠ ∅`                                      |
| Dates    | DateRangePicker + presets (today / week / overdue)                    | `from=<d>&to=<d>&overdue=1`    | `task.dueDate` in range or `dueDate < now() AND column.kind=ACTIVE`  |
| Labels   | Checkbox list with color swatches                                     | `labels=<ids>`                 | `task.labels ∩ selected ≠ ∅`                                         |

Table view also hides tasks where `column.kind ∈ {DONE, CANCELLED}` (user requirement). Board and Gantt views show them.

### Settings dialog

Triggered from the page "⋯" menu, under "Экспорт". MUI Dialog with 4 tabs:

- **Типы** / **Метки** / **Приоритеты** — sortable lists with inline-edit title (double-click), color picker, delete button.
- **Статусы** — same plus a `kind` dropdown (`ACTIVE | DONE | CANCELLED`).

Delete confirmation for **Статусы** warns "N tasks will move to column «<first>»". Last column cannot be deleted (button disabled, tooltip "Должна быть хотя бы одна колонка").

Permission for settings actions: page creator or workspace OWNER (`assertPageOwnership`).

### Comments

- Editor: Tiptap-lite with StarterKit + Link + Mention (workspace members). Submit on `Ctrl+Enter` or click.
- Storage: `TaskComment.content` as JSON; rendered via `generateHTML` from `@tiptap/html`.
- Edit/delete: author only (or workspace OWNER). Soft-delete (`deletedAt`) shown as "Комментарий удалён" placeholder.
- Realtime: `comment.upserted` event → `utils.kanban.comment.list.invalidate({ taskId })`.

### Activity log

Server writes `TaskActivity` inside the same transaction as the mutating procedure. Helper signature:

```ts
recordActivity(tx, { taskId, actorId, type: TaskActivityType, payload?: object })
```

- `MOVED` payload: `{ fromColumnId, toColumnId, fromColumnTitle, toColumnTitle }`.
- `STATUS_CHANGED` emitted in addition to `MOVED` when the source / target columns have different `kind`.
- `TYPE_CHANGED`, `PRIORITY_CHANGED`, `SPRINT_CHANGED`, `PARENT_CHANGED`: `{ fromId, toId }`.
- `RENAMED`, `DESCRIPTION_CHANGED`: no values stored (avoids duplicating data); just the fact + actor.
- `DUE_DATE_CHANGED`, `START_DATE_CHANGED`: `{ from, to }` ISO strings.
- `LABELED`/`UNLABELED`/`ASSIGNED`/`UNASSIGNED`: `{ labelId }` or `{ userId }`.

Rendered in `TaskActivityList` as human-readable lines:

```
[avatar] Виктор перенёс из «Todo» в «In Progress»     5 мин назад
[avatar] Анна добавила метку «urgent»                  10 мин назад
[avatar] Виктор создал задачу                          вчера, 14:32
```

In P4, comments and activity entries interleave by `createdAt` (like Linear) under the task detail view.

### Attachments

- Storage: `@repo/storage` (existing S3/MinIO bucket `attachments`). Key prefix `kanban/<pageId>/<taskId>/<uuid>-<fileName>`.
- Upload flow:
  1. `attachment.presignUpload({ taskId, fileName, mimeType, size })` validates size & MIME, inserts `TaskAttachment` row with `finalizedAt = null`, returns `{ id, uploadUrl, expiresAt }`.
  2. Browser PUTs file directly to MinIO via presigned URL (5 min TTL).
  3. `attachment.finalize({ id })` verifies object exists, sets `finalizedAt = now()`, emits `task.updated` SSE event.
- Download: `attachment.list({ taskId })` returns rows with presigned GET URLs (5 min TTL). Client uses plain `<a href download>`.
- Limits: `STORAGE_MAX_FILE_BYTES` env (new; default 25 MiB). MIME whitelist in `apps/web/src/lib/kanban-attachment-config.ts`.
- Cleanup: cron in `apps/engines/src/apps/kanban-cleanup/` deletes `TaskAttachment` rows where `finalizedAt IS NULL AND createdAt < now() - interval '24 hours'`.

### Permissions

| Action                                            | Required role                                  |
| ------------------------------------------------- | ---------------------------------------------- |
| Read board / tasks / comments / activity          | `WorkspaceMember`                              |
| Create / update / archive tasks, comments         | `WorkspaceMember`                              |
| Soft-delete / hard-delete task                    | Task creator **or** workspace OWNER            |
| Settings (columns / types / priorities / labels)  | Page creator **or** workspace OWNER            |
| Sprint create / activate / complete / delete      | Page creator **or** workspace OWNER            |
| Delete another user's comment                     | Workspace OWNER                                |
| Delete attachment                                 | Uploader **or** workspace OWNER                |

Implementation: all procedures begin with `assertPageAccess(pageId)`. Settings-mutating procedures additionally call `assertPageOwnership(pageId)` (existing helper in `packages/trpc/src/routers/page.ts`).

### Migrations

One Prisma migration in P1: `<timestamp>_kanban_initial.sql`. Generated by `pnpm --filter @repo/db exec prisma migrate dev --name kanban_initial`. Includes:

1. All new enums.
2. All new tables with FKs (`onDelete: Cascade` where applicable).
3. Page / User reverse relations (no schema change; Prisma generates client only).
4. Raw SQL at the end:
   ```sql
   CREATE UNIQUE INDEX sprint_one_active_per_page
     ON sprints (page_id)
     WHERE status = 'ACTIVE';
   ```

Applied in CI via existing `prisma migrate deploy`.

### Tests

- `packages/trpc/test/kanban.*.test.ts` (vitest, real Postgres via `pnpm dev` compose or Testcontainers, matching the project's existing pattern):
  - `column.delete` reassigns tasks to first column.
  - `column.delete` on last column → BAD_REQUEST.
  - `sprint.activate` demotes prior ACTIVE.
  - Concurrent `sprint.activate` → second call gets CONFLICT (partial unique index).
  - `task.move` writes both `MOVED` and `STATUS_CHANGED` when columns have different `kind`.
  - `task.setLabels` diffs correctly: removes obsolete `LABELED`, adds `UNLABELED`.
  - Permissions: non-owner can't delete another user's task; OWNER can.
- `apps/web/test/kanban/apply-filters.test.ts` (vitest, node env): pure filter predicates.
- `apps/e2e/kanban.spec.ts` (Playwright):
  1. Sign up + create KANBAN page → 3 default columns rendered.
  2. Create task via toolbar → appears in first column.
  3. DnD card to "In Progress" → reload → still there.
  4. Create sprint, activate it → "Текущий спринт" filter default-applied.
  5. Assign self + add label + set due date → reflected on card preview.
  6. Apply "User" filter → board narrows.
  7. Soft-delete the page via tRPC → `prisma.task.findMany({ where: { pageId } })` returns rows.
  8. Hard-delete the page → all rows in `tasks`, `kanban_columns`, etc. for that pageId are gone (cascade verification).

---

## 7. Phasing

| Phase  | Scope                                                                                                                                                                                                                                                                                                 | Acceptance                                                                                                                                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | Prisma schema (all tables + enums + partial unique index). tRPC `kanban.{board,column,type,priority,label,task,events}`. Seed defaults on `page.create`. Board view with DnD. `KanbanBoardPage` dispatch. Workspace tree menu entry. Realtime SSE bus (in-memory).                                     | Create board → 3 default columns. Create cards → in first column. DnD between columns persists after refresh. Assignee + due date editable on the card. Concurrent sessions see updates without refresh.                                                |
| **P2** | Sprint model + `kanban.sprint`. Table view with sprint sections and backlog DnD. Filters (Sprint / User / Dates / Labels) wired to URL; pure filter function.                                                                                                                                          | Create sprint → activate → fires "Текущий спринт" default filter. Drag task between sprint sections. Filters narrow visible tasks across all views.                                                                                                     |
| **P3** | Gantt view (`gantt-task-react`). Settings dialog with 4 tabs (Types / Labels / Priorities / Statuses), each DnD-sortable. Column delete with task reassignment confirmation.                                                                                                                           | All 3 views switchable from toolbar. Settings persist. Deleting a status column reassigns tasks to first column. Reordering settings via DnD persists.                                                                                                  |
| **P4** | Task comments (Tiptap-lite + mentions). Activity log UI. Attachments (TaskAttachment + MinIO + presigned URLs + cleanup cron in `apps/engines`). `Task.parentId` (dependency picker, hierarchy display). Archive / soft-delete on tasks. Postgres LISTEN/NOTIFY layer for `kanbanBus` (multi-instance). | Comments visible in realtime to all participants. Activity log shows create / move / status / assign / label / due-date changes. Attachments upload via presigned URLs, download via presigned GET. Parent/child dependency rendered in detail modal.   |

Each phase ships behind its own PR. Phase 1 unblocks user testing; later phases add capabilities incrementally without re-touching the schema (except `KanbanColumnKind` and `SprintStatus` already cover all known UX needs).

---

## 8. Open questions / future work

- **Workspace-level shared label sets.** If users complain about re-creating the same labels per board, a `WorkspaceLabel` table with optional override at the board level could be added. Out of scope.
- **Bulk operations.** Multi-select + bulk move / label is common in Jira/Linear; not in this design.
- **Search.** Tasks are not vectorized for AI search. If needed later: write `outbox_events` rows in `task.create`/`task.update`, extend `apps/agents` indexer to handle a new `task` aggregate type. No schema change required.
- **Mobile responsive Gantt.** `gantt-task-react` is desktop-first; mobile users get the Table view by default at `<md` breakpoint. Detection in `KanbanBoardPage` via `useMediaQuery`.
- **History rollback.** Activity log is informational, not undoable. "Undo last move" is out of scope; mention here as a known limitation.
