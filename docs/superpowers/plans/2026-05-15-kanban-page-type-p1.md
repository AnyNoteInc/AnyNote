# Kanban Page Type — P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation of the KANBAN page type — database schema, tRPC routers (board / column / type / priority / label / task / events), board-view UI with `@hello-pangea/dnd`, and realtime via tRPC v11 SSE subscriptions. Acceptance: create board → 3 default columns; create cards → in first column; DnD between columns persists after refresh; assignee + due date editable on the card; concurrent sessions see updates without refresh.

**Architecture:** All kanban entities (`KanbanColumn`, `KanbanType`, `KanbanPriority`, `KanbanLabel`, `Task`, plus pivot tables and activity log) live in Postgres with FK on `Page` and `onDelete: Cascade`. tRPC router `kanban.*` exposes queries + mutations + one SSE subscription (`events.subscribe`). Realtime bus is an in-memory `EventEmitter` keyed by `pageId`. Default columns/types/priorities are seeded in the same transaction as `page.create` when `type === 'KANBAN'`.

**Tech Stack:** Prisma 7 + Postgres, tRPC v11, vitest (with mocked Prisma), React 19, MUI v6, `@hello-pangea/dnd`, Playwright.

**Source spec:** [docs/superpowers/specs/2026-05-15-kanban-page-type-design.md](../specs/2026-05-15-kanban-page-type-design.md)

---

## File Structure

### Created

| Path | Purpose |
|------|---------|
| `packages/db/prisma/migrations/<ts>_kanban_initial/migration.sql` | Tables, enums, partial unique index |
| `packages/trpc/src/realtime/kanban-bus.ts` | In-memory `EventEmitter` for SSE fan-out |
| `packages/trpc/src/routers/kanban/helpers.ts` | Position math, default seeds, recordActivity |
| `packages/trpc/src/routers/kanban/board.ts` | `getBoard`, `getTask`, `getActivity` |
| `packages/trpc/src/routers/kanban/column.ts` | Column CRUD + reorder + delete-with-reassign |
| `packages/trpc/src/routers/kanban/type.ts` | Type CRUD + reorder |
| `packages/trpc/src/routers/kanban/priority.ts` | Priority CRUD + reorder |
| `packages/trpc/src/routers/kanban/label.ts` | Label CRUD + reorder (with palette validation) |
| `packages/trpc/src/routers/kanban/task.ts` | Task CRUD + move + setAssignees + setLabels + softDelete |
| `packages/trpc/src/routers/kanban/events.ts` | `events.subscribe` (SSE) |
| `packages/trpc/src/routers/kanban/index.ts` | Aggregator router |
| `packages/trpc/test/kanban-board.test.ts` | `getBoard` shape, permissions |
| `packages/trpc/test/kanban-column.test.ts` | CRUD + delete-reassign + last-column guard |
| `packages/trpc/test/kanban-task.test.ts` | create defaults, move + activity, permissions |
| `packages/trpc/test/kanban-helpers.test.ts` | Position math, defaults seed |
| `apps/web/src/components/kanban/kanban-board-page.tsx` | Top-level: getBoard, mount events, view state |
| `apps/web/src/components/kanban/kanban-toolbar.tsx` | Title row + Create Task button |
| `apps/web/src/components/kanban/views/board-view.tsx` | `DragDropContext` + columns |
| `apps/web/src/components/kanban/views/board-column.tsx` | `Droppable` body |
| `apps/web/src/components/kanban/views/board-card.tsx` | `Draggable` preview |
| `apps/web/src/components/kanban/task/task-detail-container.tsx` | Reads `?taskId` from URL |
| `apps/web/src/components/kanban/task/task-detail-modal.tsx` | MUI Dialog |
| `apps/web/src/components/kanban/task/task-form.tsx` | Shared form body (title + assignees + due date for P1) |
| `apps/web/src/components/kanban/realtime/use-kanban-events.ts` | SSE subscription hook |
| `apps/web/src/components/kanban/lib/positions.ts` | Float position helpers (`positionBetween`, `endPosition`) |
| `apps/e2e/kanban-board.spec.ts` | P1 acceptance E2E |

### Modified

| Path | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add enums, 11 new models, reverse relations on `Page`/`User` |
| `packages/db/src/index.ts` | Re-export new types from `@prisma/client` |
| `packages/trpc/src/index.ts` | Mount `kanban` router |
| `packages/trpc/src/routers/page.ts` | `page.create` seeds defaults when `type === 'KANBAN'` |
| `packages/ui/src/components/index.ts` | Re-export `ViewKanbanIcon` |
| `apps/web/package.json` | Add `@hello-pangea/dnd` dep |
| `apps/web/src/trpc/client.tsx` | Add `splitLink` with `httpSubscriptionLink` |
| `apps/web/src/components/page/page-renderer.tsx` | Dispatch branch for `KANBAN` |
| `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx` | Extend `isFullBleed` |
| `apps/web/src/components/workspace/page-tree-section.tsx` | Extend `CreatablePageType` + menu entry |
| `apps/web/src/components/page/page-actions-toolbar.tsx` | Extend type union |
| `apps/web/src/components/page/page-actions-menu.tsx` | Extend type union |

---

## Conventions used across tasks

- **TDD**: write the failing test first (with full body), run, see RED, implement, run, see GREEN, commit.
- **Mocked Prisma in tRPC tests** (matches `packages/trpc/test/reminder-router.test.ts`): no Testcontainers; mock `@repo/db` and pass a fake `prisma` into `createCallerFactory(router)(ctx)`.
- **Commit format**: Conventional Commits with scope `kanban`. Example: `feat(kanban): add column router`. Husky runs lint-staged + gates on commit.
- **Run tests with**: `pnpm --filter @repo/trpc test -- <pattern>` (vitest's `--` separator). Single file: `pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-column.test.ts`.
- **Run schema commands with**: `pnpm --filter @repo/db exec prisma <subcommand>`.

---

## Task 1: Prisma schema — enums, settings models, page/user relations

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add enums above `Page` model**

Append in the enums block (top of file, near existing `PageType`):

```prisma
enum KanbanColumnKind {
  ACTIVE
  DONE
  CANCELLED
}

enum SprintStatus {
  PLANNED
  ACTIVE
  COMPLETED
}

enum TaskActivityType {
  CREATED
  MOVED
  STATUS_CHANGED
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

- [ ] **Step 2: Add settings models (Column / Type / Priority / Label)**

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
  color     String
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

- [ ] **Step 3: Add Sprint, Task, and pivot/log/attachment models**

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

model Task {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId         String   @map("page_id") @db.Uuid
  columnId       String   @map("column_id") @db.Uuid
  typeId         String?  @map("type_id") @db.Uuid
  priorityId     String?  @map("priority_id") @db.Uuid
  sprintId       String?  @map("sprint_id") @db.Uuid
  parentId       String?  @map("parent_id") @db.Uuid
  title          String
  description    Json?
  startDate      DateTime? @map("start_date")
  dueDate        DateTime? @map("due_date")
  position       Float
  sprintPosition Float?    @map("sprint_position")
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
  content   Json
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
  payload   Json?
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
  finalizedAt  DateTime? @map("finalized_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  deletedAt    DateTime? @map("deleted_at")

  task       Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  uploadedBy User @relation(fields: [uploadedById], references: [id])

  @@index([taskId, createdAt])
  @@map("task_attachments")
}
```

- [ ] **Step 4: Add reverse relations to `Page` model**

Find `model Page {` and append inside the relations block:

```prisma
  kanbanColumns    KanbanColumn[]
  kanbanTypes      KanbanType[]
  kanbanPriorities KanbanPriority[]
  kanbanLabels     KanbanLabel[]
  sprints          Sprint[]
  tasks            Task[]
```

- [ ] **Step 5: Add reverse relations to `User` model**

Find `model User {` and append inside the relations block:

```prisma
  tasksCreated     Task[]           @relation("TaskCreator")
  tasksUpdated     Task[]           @relation("TaskUpdater")
  taskAssignments  TaskAssignee[]
  taskComments     TaskComment[]
  taskActivity     TaskActivity[]
  taskAttachments  TaskAttachment[]
```

- [ ] **Step 6: Generate migration with raw partial unique SQL**

Run:
```bash
pnpm --filter @repo/db exec prisma migrate dev --name kanban_initial --create-only
```

Expected: creates `packages/db/prisma/migrations/<timestamp>_kanban_initial/migration.sql` without applying it.

- [ ] **Step 7: Append partial unique index to migration SQL**

Open the generated `migration.sql` and append at the bottom:

```sql
-- Enforce exactly one ACTIVE sprint per page
CREATE UNIQUE INDEX "sprint_one_active_per_page"
  ON "sprints" ("page_id")
  WHERE "status" = 'ACTIVE';
```

- [ ] **Step 8: Apply migration and regenerate client**

Run:
```bash
pnpm --filter @repo/db exec prisma migrate dev
pnpm --filter @repo/db prisma:generate
```

Expected: migration applies cleanly; client regenerates with new types.

- [ ] **Step 9: Verify type exports**

Open `packages/db/src/index.ts`. Confirm that the generated namespace export forwards all new types. If the file does not re-export the entire `@prisma/client` namespace, add:

```typescript
export type {
  KanbanColumn,
  KanbanType,
  KanbanPriority,
  KanbanLabel,
  Sprint,
  Task,
  TaskAssignee,
  KanbanLabelOnTask,
  TaskComment,
  TaskActivity,
  TaskAttachment,
  KanbanColumnKind,
  SprintStatus,
  TaskActivityType,
} from '@prisma/client'
```

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/index.ts
git commit -m "feat(db): add kanban schema (columns, tasks, sprints, labels, activity)"
```

---

## Task 2: In-memory kanban-bus

**Files:**
- Create: `packages/trpc/src/realtime/kanban-bus.ts`
- Create: `packages/trpc/test/kanban-bus.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/trpc/test/kanban-bus.test.ts
import { describe, expect, it, vi } from 'vitest'

import { KanbanBus, type KanbanEvent } from '../src/realtime/kanban-bus'

const PAGE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PAGE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const EVENT: KanbanEvent = { kind: 'task.created', taskId: '00000000-0000-0000-0000-000000000001' }

describe('KanbanBus', () => {
  it('delivers an event only to listeners of the same pageId', () => {
    const bus = new KanbanBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.on(PAGE_A, a)
    bus.on(PAGE_B, b)

    bus.emit(PAGE_A, EVENT)

    expect(a).toHaveBeenCalledWith(EVENT)
    expect(b).not.toHaveBeenCalled()
  })

  it('returns an unsubscribe function that stops further delivery', () => {
    const bus = new KanbanBus()
    const listener = vi.fn()
    const off = bus.on(PAGE_A, listener)

    off()
    bus.emit(PAGE_A, EVENT)

    expect(listener).not.toHaveBeenCalled()
  })

  it('removes the pageId entry when the last listener unsubscribes', () => {
    const bus = new KanbanBus()
    const off = bus.on(PAGE_A, vi.fn())
    off()

    expect(bus.listenerCount(PAGE_A)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-bus.test.ts
```

Expected: FAIL with "Cannot find module '../src/realtime/kanban-bus'".

- [ ] **Step 3: Implement bus**

```typescript
// packages/trpc/src/realtime/kanban-bus.ts
export type KanbanEvent =
  | { kind: 'task.created' | 'task.updated' | 'task.deleted' | 'task.moved'; taskId: string }
  | { kind: 'column.upserted' | 'column.deleted'; columnId: string }
  | { kind: 'sprint.upserted' | 'sprint.deleted'; sprintId: string }
  | { kind: 'comment.upserted' | 'comment.deleted'; taskId: string; commentId: string }
  | { kind: 'settings.upserted'; entity: 'type' | 'priority' | 'label' }
  | { kind: 'activity.appended'; taskId: string }

type Listener = (event: KanbanEvent) => void

export class KanbanBus {
  private listeners = new Map<string, Set<Listener>>()

  on(pageId: string, listener: Listener): () => void {
    let set = this.listeners.get(pageId)
    if (!set) {
      set = new Set()
      this.listeners.set(pageId, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) this.listeners.delete(pageId)
    }
  }

  emit(pageId: string, event: KanbanEvent): void {
    const set = this.listeners.get(pageId)
    if (!set) return
    for (const listener of set) listener(event)
  }

  listenerCount(pageId: string): number {
    return this.listeners.get(pageId)?.size ?? 0
  }
}

export const kanbanBus = new KanbanBus()
```

- [ ] **Step 4: Run tests, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-bus.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/realtime/kanban-bus.ts packages/trpc/test/kanban-bus.test.ts
git commit -m "feat(kanban): in-memory event bus for SSE fan-out"
```

---

## Task 3: Position helpers

**Files:**
- Create: `packages/trpc/src/routers/kanban/helpers.ts` (initial — position helpers only)
- Create: `packages/trpc/test/kanban-helpers.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/trpc/test/kanban-helpers.test.ts
import { describe, expect, it } from 'vitest'

import { endPosition, positionBetween, POSITION_GAP } from '../src/routers/kanban/helpers'

describe('positionBetween', () => {
  it('returns midpoint of two finite values', () => {
    expect(positionBetween(10, 20)).toBe(15)
  })

  it('returns prev + GAP when only prev is given', () => {
    expect(positionBetween(10, null)).toBe(10 + POSITION_GAP)
  })

  it('returns next - GAP when only next is given', () => {
    expect(positionBetween(null, 20)).toBe(20 - POSITION_GAP)
  })

  it('returns 0 when neither is given (first item ever)', () => {
    expect(positionBetween(null, null)).toBe(0)
  })

  it('throws if gap underflows below precision floor', () => {
    expect(() => positionBetween(10, 10 + 1e-20)).toThrow(/precision/i)
  })
})

describe('endPosition', () => {
  it('returns 0 for empty array', () => {
    expect(endPosition([])).toBe(0)
  })

  it('returns max + GAP for non-empty', () => {
    expect(endPosition([{ position: 1 }, { position: 5 }, { position: 3 }])).toBe(5 + POSITION_GAP)
  })
})
```

- [ ] **Step 2: Run test, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-helpers.test.ts
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement helpers**

```typescript
// packages/trpc/src/routers/kanban/helpers.ts
export const POSITION_GAP = 1024
const PRECISION_FLOOR = Number.EPSILON * 1024

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) {
    const gap = next - prev
    if (gap < PRECISION_FLOOR) {
      throw new Error('Position precision underflow — rebalance required')
    }
    return prev + gap / 2
  }
  if (prev !== null) return prev + POSITION_GAP
  if (next !== null) return next - POSITION_GAP
  return 0
}

export function endPosition(items: { position: number }[]): number {
  if (items.length === 0) return 0
  let max = items[0].position
  for (const item of items) if (item.position > max) max = item.position
  return max + POSITION_GAP
}
```

- [ ] **Step 4: Run tests, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-helpers.test.ts
```

Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/helpers.ts packages/trpc/test/kanban-helpers.test.ts
git commit -m "feat(kanban): position math helpers"
```

---

## Task 4: Default seed helper + recordActivity helper

**Files:**
- Modify: `packages/trpc/src/routers/kanban/helpers.ts`
- Modify: `packages/trpc/test/kanban-helpers.test.ts`

- [ ] **Step 1: Write failing tests for seed + recordActivity**

Append to `packages/trpc/test/kanban-helpers.test.ts`:

```typescript
import { vi } from 'vitest'
import { seedKanbanDefaults, recordActivity } from '../src/routers/kanban/helpers'

describe('seedKanbanDefaults', () => {
  it('inserts 3 columns, 2 types, 5 priorities into the given tx', async () => {
    const columnCreateMany = vi.fn().mockResolvedValue({ count: 3 })
    const typeCreateMany = vi.fn().mockResolvedValue({ count: 2 })
    const priorityCreateMany = vi.fn().mockResolvedValue({ count: 5 })
    const tx = {
      kanbanColumn: { createMany: columnCreateMany },
      kanbanType: { createMany: typeCreateMany },
      kanbanPriority: { createMany: priorityCreateMany },
    } as never

    await seedKanbanDefaults(tx, 'page-1')

    expect(columnCreateMany).toHaveBeenCalledOnce()
    expect(columnCreateMany.mock.calls[0][0].data).toHaveLength(3)
    expect(columnCreateMany.mock.calls[0][0].data[0]).toMatchObject({ pageId: 'page-1', title: 'Todo', kind: 'ACTIVE' })
    expect(columnCreateMany.mock.calls[0][0].data[2]).toMatchObject({ title: 'Done', kind: 'DONE' })
    expect(typeCreateMany.mock.calls[0][0].data).toEqual([
      { pageId: 'page-1', title: 'Задача', position: 1024 },
      { pageId: 'page-1', title: 'Баг', position: 2048 },
    ])
    expect(priorityCreateMany.mock.calls[0][0].data).toHaveLength(5)
    expect(priorityCreateMany.mock.calls[0][0].data.map((p: { title: string }) => p.title)).toEqual([
      'Highest', 'High', 'Medium', 'Low', 'Lowest',
    ])
  })
})

describe('recordActivity', () => {
  it('inserts a task_activity row with the given fields', async () => {
    const create = vi.fn().mockResolvedValue({})
    const tx = { taskActivity: { create } } as never

    await recordActivity(tx, {
      taskId: 't-1',
      actorId: 'u-1',
      type: 'MOVED',
      payload: { fromColumnId: 'c-1', toColumnId: 'c-2' },
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        taskId: 't-1',
        actorId: 'u-1',
        type: 'MOVED',
        payload: { fromColumnId: 'c-1', toColumnId: 'c-2' },
      },
    })
  })
})
```

- [ ] **Step 2: Run, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-helpers.test.ts
```

- [ ] **Step 3: Implement**

Append to `packages/trpc/src/routers/kanban/helpers.ts`:

```typescript
import type { Prisma, TaskActivityType } from '@repo/db'

type TxClient = Prisma.TransactionClient

export async function seedKanbanDefaults(tx: TxClient, pageId: string): Promise<void> {
  await tx.kanbanColumn.createMany({
    data: [
      { pageId, title: 'Todo', kind: 'ACTIVE', position: 1024 },
      { pageId, title: 'In Progress', kind: 'ACTIVE', position: 2048 },
      { pageId, title: 'Done', kind: 'DONE', position: 3072 },
    ],
  })
  await tx.kanbanType.createMany({
    data: [
      { pageId, title: 'Задача', position: 1024 },
      { pageId, title: 'Баг', position: 2048 },
    ],
  })
  await tx.kanbanPriority.createMany({
    data: [
      { pageId, title: 'Highest', position: 1024 },
      { pageId, title: 'High', position: 2048 },
      { pageId, title: 'Medium', position: 3072 },
      { pageId, title: 'Low', position: 4096 },
      { pageId, title: 'Lowest', position: 5120 },
    ],
  })
}

export async function recordActivity(
  tx: TxClient,
  input: {
    taskId: string
    actorId: string
    type: TaskActivityType
    payload?: Record<string, unknown>
  },
): Promise<void> {
  await tx.taskActivity.create({
    data: {
      taskId: input.taskId,
      actorId: input.actorId,
      type: input.type,
      payload: input.payload ?? undefined,
    },
  })
}
```

- [ ] **Step 4: Run, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-helpers.test.ts
```

Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/helpers.ts packages/trpc/test/kanban-helpers.test.ts
git commit -m "feat(kanban): default-seed and activity-log helpers"
```

---

## Task 5: Shared `assertPageAccess` helper module

The procedures in `kanban.*` need `assertPageAccess` and `assertPageOwnership`. They already exist as private functions in `packages/trpc/src/routers/page.ts`. To avoid duplicating logic, extract them into a shared module.

**Files:**
- Create: `packages/trpc/src/helpers/page-access.ts`
- Modify: `packages/trpc/src/routers/page.ts`

- [ ] **Step 1: Create the shared module**

```typescript
// packages/trpc/src/helpers/page-access.ts
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'

type Ctx = { prisma: PrismaClient; user: { id: string } }

export async function assertWorkspaceMember(ctx: Ctx, workspaceId: string) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником воркспейса' })
  }
  return member
}

export async function assertPageAccess(ctx: Ctx, pageId: string) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: { members: { some: { userId: ctx.user.id } } },
    },
  })
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  return page
}

export async function assertPageOwnership(ctx: Ctx, pageId: string, workspaceId: string) {
  const [page, member] = await Promise.all([
    ctx.prisma.page.findFirst({
      where: {
        id: pageId,
        workspaceId,
        workspace: { members: { some: { userId: ctx.user.id } } },
      },
    }),
    ctx.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
    }),
  ])
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником воркспейса' })
  }
  const isOwner = member.role === 'OWNER'
  const isCreator = page.createdById === ctx.user.id
  if (!isOwner && !isCreator) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return page
}
```

- [ ] **Step 2: Replace inline helpers in `page.ts` with re-imports**

In `packages/trpc/src/routers/page.ts`, delete the three local `assertWorkspaceMember`, `assertPageAccess`, `assertPageOwnership` functions (lines ~10-68 per the spec exploration). Add at the top:

```typescript
import {
  assertWorkspaceMember,
  assertPageAccess,
  assertPageOwnership,
} from '../helpers/page-access'
```

- [ ] **Step 3: Run `page` router tests to make sure nothing broke**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/helpers/page-access.ts packages/trpc/src/routers/page.ts
git commit -m "refactor(trpc): extract page-access helpers for kanban reuse"
```

---

## Task 6: `kanban.board.getBoard` query

**Files:**
- Create: `packages/trpc/src/routers/kanban/board.ts`
- Create: `packages/trpc/test/kanban-board.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/trpc/test/kanban-board.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { boardRouter } from '../src/routers/kanban/board'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: {
      id: USER_ID,
      email: 't@e.com',
      firstName: 'T',
      lastName: 'U',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

describe('kanban.board.getBoard', () => {
  it('returns columns, types, priorities, labels, sprints, tasks, members', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue({ id: PAGE_ID, workspaceId: WORKSPACE_ID, createdById: USER_ID }),
      },
      kanbanColumn: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Todo' }]) },
      kanbanType: { findMany: vi.fn().mockResolvedValue([{ id: 'tp1' }]) },
      kanbanPriority: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
      kanbanLabel: { findMany: vi.fn().mockResolvedValue([]) },
      sprint: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([{ id: 't1', title: 'Hello' }]) },
      workspaceMember: { findMany: vi.fn().mockResolvedValue([{ userId: USER_ID, role: 'OWNER' }]) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(boardRouter)(ctx(prisma))
    const result = await caller.getBoard({ pageId: PAGE_ID })

    expect(result.columns).toHaveLength(1)
    expect(result.tasks).toHaveLength(1)
    expect(result.members).toHaveLength(1)
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pageId: PAGE_ID, deletedAt: null, archived: false },
      }),
    )
  })

  it('throws NOT_FOUND when user is not a workspace member', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(boardRouter)(ctx(prisma))
    await expect(caller.getBoard({ pageId: PAGE_ID })).rejects.toThrow(/не найдена/i)
  })
})
```

- [ ] **Step 2: Run, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-board.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/trpc/src/routers/kanban/board.ts
import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'

export const boardRouter = router({
  getBoard: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)

      const [columns, types, priorities, labels, sprints, tasks, members] = await Promise.all([
        ctx.prisma.kanbanColumn.findMany({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
        ctx.prisma.kanbanType.findMany({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
        ctx.prisma.kanbanPriority.findMany({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
        ctx.prisma.kanbanLabel.findMany({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
        ctx.prisma.sprint.findMany({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
        ctx.prisma.task.findMany({
          where: { pageId: page.id, deletedAt: null, archived: false },
          include: {
            assignees: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
            labels: { include: { label: true } },
          },
          orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
        }),
        ctx.prisma.workspaceMember.findMany({
          where: { workspaceId: page.workspaceId },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        }),
      ])

      return { columns, types, priorities, labels, sprints, tasks, members }
    }),
})
```

- [ ] **Step 4: Run, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-board.test.ts
```

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/board.ts packages/trpc/test/kanban-board.test.ts
git commit -m "feat(kanban): board.getBoard query with permission check"
```

---

## Task 7: `kanban.column` router (create/update/reorder/delete with reassign)

**Files:**
- Create: `packages/trpc/src/routers/kanban/column.ts`
- Create: `packages/trpc/test/kanban-column.test.ts`

- [ ] **Step 1: Write failing tests for create + delete-reassign + last-column guard**

```typescript
// packages/trpc/test/kanban-column.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { columnRouter } from '../src/routers/kanban/column'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const COL_A = '00000000-0000-0000-0000-00000000000a'
const COL_B = '00000000-0000-0000-0000-00000000000b'

function ctx(prisma: PrismaClient, userId = USER_ID) {
  return {
    prisma,
    user: { id: userId, email: 't@e.com', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

const pageRow = { id: PAGE_ID, workspaceId: WORKSPACE_ID, createdById: USER_ID }

describe('kanban.column.create', () => {
  it('inserts at end position when no positioning args given', async () => {
    const create = vi.fn().mockResolvedValue({ id: COL_A })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([{ position: 1024 }, { position: 2048 }]),
        create,
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await caller.create({ pageId: PAGE_ID, title: 'Review', kind: 'ACTIVE' })

    expect(create).toHaveBeenCalledWith({
      data: { pageId: PAGE_ID, title: 'Review', kind: 'ACTIVE', position: 2048 + 1024 },
    })
  })
})

describe('kanban.column.delete', () => {
  it('reassigns tasks to first remaining column then deletes', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 })
    const deleteCol = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { updateMany },
      kanbanColumn: { delete: deleteCol },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([
          { id: COL_A, position: 1024 },
          { id: COL_B, position: 2048 },
        ]),
      },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await caller.delete({ pageId: PAGE_ID, id: COL_B })

    expect(updateMany).toHaveBeenCalledWith({
      where: { columnId: COL_B },
      data: { columnId: COL_A },
    })
    expect(deleteCol).toHaveBeenCalledWith({ where: { id: COL_B } })
  })

  it('rejects deleting the last column with BAD_REQUEST', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([{ id: COL_A, position: 1024 }]),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await expect(caller.delete({ pageId: PAGE_ID, id: COL_A })).rejects.toThrow(/последнюю/i)
  })

  it('requires ownership (FORBIDDEN for non-owner non-creator)', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue({ ...pageRow, createdById: 'someone-else' }) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(columnRouter)(ctx(prisma))
    await expect(caller.delete({ pageId: PAGE_ID, id: COL_A })).rejects.toThrow(/прав/i)
  })
})
```

- [ ] **Step 2: Run, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-column.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/trpc/src/routers/kanban/column.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { endPosition, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

const ColumnKindEnum = z.enum(['ACTIVE', 'DONE', 'CANCELLED'])

export const columnRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        title: z.string().min(1).max(120),
        kind: ColumnKindEnum.default('ACTIVE'),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const existing = await ctx.prisma.kanbanColumn.findMany({
        where: { pageId: page.id },
        select: { position: true },
      })
      const column = await ctx.prisma.kanbanColumn.create({
        data: {
          pageId: page.id,
          title: input.title,
          kind: input.kind,
          color: input.color,
          position: endPosition(existing),
        },
      })
      kanbanBus.emit(page.id, { kind: 'column.upserted', columnId: column.id })
      return column
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        title: z.string().min(1).max(120).optional(),
        kind: ColumnKindEnum.optional(),
        color: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const column = await ctx.prisma.kanbanColumn.update({
        where: { id: input.id },
        data: {
          title: input.title,
          kind: input.kind,
          color: input.color,
        },
      })
      kanbanBus.emit(page.id, { kind: 'column.upserted', columnId: column.id })
      return column
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        beforeId: z.string().uuid().nullable(),
        afterId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const cols = await ctx.prisma.kanbanColumn.findMany({
        where: { pageId: page.id },
        select: { id: true, position: true },
      })
      const prev = input.beforeId ? cols.find((c) => c.id === input.beforeId)?.position ?? null : null
      const next = input.afterId ? cols.find((c) => c.id === input.afterId)?.position ?? null : null
      const position = positionBetween(prev, next)
      const column = await ctx.prisma.kanbanColumn.update({
        where: { id: input.id },
        data: { position },
      })
      kanbanBus.emit(page.id, { kind: 'column.upserted', columnId: column.id })
      return column
    }),

  delete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const cols = await ctx.prisma.kanbanColumn.findMany({
        where: { pageId: page.id },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      })
      if (cols.length <= 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Нельзя удалить последнюю колонку доски',
        })
      }
      const remaining = cols.filter((c) => c.id !== input.id)
      const firstRemaining = remaining[0]
      await ctx.prisma.$transaction(async (tx) => {
        await tx.task.updateMany({
          where: { columnId: input.id },
          data: { columnId: firstRemaining.id },
        })
        await tx.kanbanColumn.delete({ where: { id: input.id } })
      })
      kanbanBus.emit(page.id, { kind: 'column.deleted', columnId: input.id })
      return { ok: true as const, reassignedTo: firstRemaining.id }
    }),
})

async function pageWorkspaceId(
  ctx: { prisma: import('@repo/db').PrismaClient },
  pageId: string,
): Promise<string> {
  const page = await ctx.prisma.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { workspaceId: true },
  })
  return page.workspaceId
}
```

- [ ] **Step 4: Run, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-column.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/column.ts packages/trpc/test/kanban-column.test.ts
git commit -m "feat(kanban): column router with task reassignment on delete"
```

---

## Task 8: `kanban.type` router

**Files:**
- Create: `packages/trpc/src/routers/kanban/type.ts`

This router mirrors `column` but without the `delete-with-reassign` guard (tasks just get `typeId = null` via FK `SetNull`). No new test file needed — the `column` patterns are sufficient coverage; we'll add a focused test in Task 11 (settings tab tests). For now implementation only.

- [ ] **Step 1: Implement**

```typescript
// packages/trpc/src/routers/kanban/type.ts
import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { endPosition, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

export const typeRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        title: z.string().min(1).max(120),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const existing = await ctx.prisma.kanbanType.findMany({
        where: { pageId: page.id },
        select: { position: true },
      })
      const row = await ctx.prisma.kanbanType.create({
        data: {
          pageId: page.id,
          title: input.title,
          color: input.color,
          position: endPosition(existing),
        },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'type' })
      return row
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        title: z.string().min(1).max(120).optional(),
        color: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const row = await ctx.prisma.kanbanType.update({
        where: { id: input.id },
        data: { title: input.title, color: input.color },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'type' })
      return row
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        beforeId: z.string().uuid().nullable(),
        afterId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const rows = await ctx.prisma.kanbanType.findMany({
        where: { pageId: page.id },
        select: { id: true, position: true },
      })
      const prev = input.beforeId ? rows.find((r) => r.id === input.beforeId)?.position ?? null : null
      const next = input.afterId ? rows.find((r) => r.id === input.afterId)?.position ?? null : null
      const row = await ctx.prisma.kanbanType.update({
        where: { id: input.id },
        data: { position: positionBetween(prev, next) },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'type' })
      return row
    }),

  delete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      await ctx.prisma.kanbanType.delete({ where: { id: input.id } })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'type' })
      return { ok: true as const }
    }),
})

async function pageWorkspaceId(
  ctx: { prisma: import('@repo/db').PrismaClient },
  pageId: string,
): Promise<string> {
  const page = await ctx.prisma.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { workspaceId: true },
  })
  return page.workspaceId
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/trpc/src/routers/kanban/type.ts
git commit -m "feat(kanban): type router (CRUD + reorder)"
```

---

## Task 9: `kanban.priority` router

**Files:**
- Create: `packages/trpc/src/routers/kanban/priority.ts`

Same shape as `type` router — just replace `kanbanType` with `kanbanPriority` and `entity: 'type'` with `entity: 'priority'`.

- [ ] **Step 1: Implement**

```typescript
// packages/trpc/src/routers/kanban/priority.ts
import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { endPosition, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

export const priorityRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        title: z.string().min(1).max(120),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const existing = await ctx.prisma.kanbanPriority.findMany({
        where: { pageId: page.id },
        select: { position: true },
      })
      const row = await ctx.prisma.kanbanPriority.create({
        data: {
          pageId: page.id,
          title: input.title,
          color: input.color,
          position: endPosition(existing),
        },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'priority' })
      return row
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        title: z.string().min(1).max(120).optional(),
        color: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const row = await ctx.prisma.kanbanPriority.update({
        where: { id: input.id },
        data: { title: input.title, color: input.color },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'priority' })
      return row
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        beforeId: z.string().uuid().nullable(),
        afterId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const rows = await ctx.prisma.kanbanPriority.findMany({
        where: { pageId: page.id },
        select: { id: true, position: true },
      })
      const prev = input.beforeId ? rows.find((r) => r.id === input.beforeId)?.position ?? null : null
      const next = input.afterId ? rows.find((r) => r.id === input.afterId)?.position ?? null : null
      const row = await ctx.prisma.kanbanPriority.update({
        where: { id: input.id },
        data: { position: positionBetween(prev, next) },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'priority' })
      return row
    }),

  delete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      await ctx.prisma.kanbanPriority.delete({ where: { id: input.id } })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'priority' })
      return { ok: true as const }
    }),
})

async function pageWorkspaceId(
  ctx: { prisma: import('@repo/db').PrismaClient },
  pageId: string,
): Promise<string> {
  const page = await ctx.prisma.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { workspaceId: true },
  })
  return page.workspaceId
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/trpc/src/routers/kanban/priority.ts
git commit -m "feat(kanban): priority router (CRUD + reorder)"
```

---

## Task 10: `kanban.label` router with palette validation

**Files:**
- Create: `packages/ui/src/lib/kanban-colors.ts`
- Modify: `packages/ui/src/index.ts` (or wherever `lib/` is re-exported) — verify export path
- Create: `packages/trpc/src/routers/kanban/label.ts`
- Create: `packages/trpc/test/kanban-label.test.ts`

- [ ] **Step 1: Add color palette constant in `@repo/ui`**

```typescript
// packages/ui/src/lib/kanban-colors.ts
export const KANBAN_LABEL_COLORS = [
  { name: 'red', hex: '#EF4444' },
  { name: 'orange', hex: '#F97316' },
  { name: 'yellow', hex: '#EAB308' },
  { name: 'green', hex: '#22C55E' },
  { name: 'teal', hex: '#14B8A6' },
  { name: 'blue', hex: '#3B82F6' },
  { name: 'purple', hex: '#A855F7' },
  { name: 'pink', hex: '#EC4899' },
  { name: 'gray', hex: '#6B7280' },
] as const

export const KANBAN_LABEL_COLOR_HEXES: ReadonlySet<string> = new Set(
  KANBAN_LABEL_COLORS.map((c) => c.hex),
)
```

Re-export from `packages/ui/src/index.ts` (or `lib/index.ts`, follow existing convention; check with `grep "lib/" packages/ui/src/index.ts`).

- [ ] **Step 2: Write failing test for label color validation**

```typescript
// packages/trpc/test/kanban-label.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { labelRouter } from '../src/routers/kanban/label'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID, email: 't@e.com', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

const pageRow = { id: PAGE_ID, workspaceId: WORKSPACE_ID, createdById: USER_ID }

describe('kanban.label.create', () => {
  it('rejects a color outside the palette', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(labelRouter)(ctx(prisma))
    await expect(
      caller.create({ pageId: PAGE_ID, name: 'urgent', color: '#000000' }),
    ).rejects.toThrow(/палитр/i)
  })

  it('accepts a color from the palette', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'l1' })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      kanbanLabel: { findMany: vi.fn().mockResolvedValue([]), create },
    } as unknown as PrismaClient

    const caller = createCallerFactory(labelRouter)(ctx(prisma))
    await caller.create({ pageId: PAGE_ID, name: 'urgent', color: '#EF4444' })

    expect(create).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Run, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-label.test.ts
```

- [ ] **Step 4: Implement**

```typescript
// packages/trpc/src/routers/kanban/label.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { KANBAN_LABEL_COLOR_HEXES } from '@repo/ui/lib/kanban-colors'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { endPosition, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

function assertColor(color: string) {
  if (!KANBAN_LABEL_COLOR_HEXES.has(color)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Цвет не входит в палитру',
    })
  }
}

export const labelRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        name: z.string().min(1).max(80),
        color: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertColor(input.color)
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const existing = await ctx.prisma.kanbanLabel.findMany({
        where: { pageId: page.id },
        select: { position: true },
      })
      const row = await ctx.prisma.kanbanLabel.create({
        data: {
          pageId: page.id,
          name: input.name,
          color: input.color,
          position: endPosition(existing),
        },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'label' })
      return row
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        name: z.string().min(1).max(80).optional(),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.color !== undefined) assertColor(input.color)
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const row = await ctx.prisma.kanbanLabel.update({
        where: { id: input.id },
        data: { name: input.name, color: input.color },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'label' })
      return row
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        beforeId: z.string().uuid().nullable(),
        afterId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      const rows = await ctx.prisma.kanbanLabel.findMany({
        where: { pageId: page.id },
        select: { id: true, position: true },
      })
      const prev = input.beforeId ? rows.find((r) => r.id === input.beforeId)?.position ?? null : null
      const next = input.afterId ? rows.find((r) => r.id === input.afterId)?.position ?? null : null
      const row = await ctx.prisma.kanbanLabel.update({
        where: { id: input.id },
        data: { position: positionBetween(prev, next) },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'label' })
      return row
    }),

  delete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId, await pageWorkspaceId(ctx, input.pageId))
      await ctx.prisma.kanbanLabel.delete({ where: { id: input.id } })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'label' })
      return { ok: true as const }
    }),
})

async function pageWorkspaceId(
  ctx: { prisma: import('@repo/db').PrismaClient },
  pageId: string,
): Promise<string> {
  const page = await ctx.prisma.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { workspaceId: true },
  })
  return page.workspaceId
}
```

- [ ] **Step 5: Run, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-label.test.ts
```

Expected: PASS, 2/2.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lib/kanban-colors.ts packages/ui/src/index.ts packages/trpc/src/routers/kanban/label.ts packages/trpc/test/kanban-label.test.ts
git commit -m "feat(kanban): label router with palette validation"
```

---

## Task 11: `kanban.task.create`

**Files:**
- Create: `packages/trpc/src/routers/kanban/task.ts`
- Create: `packages/trpc/test/kanban-task.test.ts`

- [ ] **Step 1: Write failing test for `task.create` with default column/type/priority resolution**

```typescript
// packages/trpc/test/kanban-task.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { taskRouter } from '../src/routers/kanban/task'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'

function ctx(prisma: PrismaClient, userId = USER_ID) {
  return {
    prisma,
    user: { id: userId, email: 't@e.com', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

const pageRow = { id: PAGE_ID, workspaceId: WORKSPACE_ID, createdById: USER_ID }

describe('kanban.task.create', () => {
  it('picks first column by position when columnId is omitted; writes CREATED activity', async () => {
    const taskCreate = vi.fn().mockResolvedValue({ id: 'task-1', title: 'New task' })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { create: taskCreate, findMany: vi.fn().mockResolvedValue([]) },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      kanbanColumn: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'col-first', pageId: PAGE_ID, position: 1024 }),
      },
      kanbanType: {
        findFirst: vi.fn().mockResolvedValue({ id: 'type-first', position: 1024 }),
      },
      kanbanPriority: {
        findFirst: vi.fn().mockResolvedValue({ id: 'pri-first', position: 1024 }),
      },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.create({ pageId: PAGE_ID, title: 'New task' })

    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: PAGE_ID,
          columnId: 'col-first',
          typeId: 'type-first',
          priorityId: 'pri-first',
          title: 'New task',
          createdById: USER_ID,
        }),
      }),
    )
    expect(activityCreate).toHaveBeenCalledWith({
      data: { taskId: 'task-1', actorId: USER_ID, type: 'CREATED', payload: undefined },
    })
    expect(result.id).toBe('task-1')
  })

  it('throws BAD_REQUEST when board has no columns', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      kanbanColumn: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await expect(caller.create({ pageId: PAGE_ID, title: 'x' })).rejects.toThrow(/колонк/i)
  })
})
```

- [ ] **Step 2: Run, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-task.test.ts
```

- [ ] **Step 3: Implement `task.create`**

```typescript
// packages/trpc/src/routers/kanban/task.ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { endPosition, recordActivity } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

export const taskRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        columnId: z.string().uuid().optional(),
        typeId: z.string().uuid().optional(),
        priorityId: z.string().uuid().optional(),
        title: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)

      const column = input.columnId
        ? await ctx.prisma.kanbanColumn.findFirst({
            where: { id: input.columnId, pageId: page.id },
          })
        : await ctx.prisma.kanbanColumn.findFirst({
            where: { pageId: page.id },
            orderBy: { position: 'asc' },
          })
      if (!column) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'У доски нет колонок — создайте хотя бы одну',
        })
      }

      const [type, priority] = await Promise.all([
        input.typeId
          ? ctx.prisma.kanbanType.findFirst({ where: { id: input.typeId, pageId: page.id } })
          : ctx.prisma.kanbanType.findFirst({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
        input.priorityId
          ? ctx.prisma.kanbanPriority.findFirst({ where: { id: input.priorityId, pageId: page.id } })
          : ctx.prisma.kanbanPriority.findFirst({
              where: { pageId: page.id },
              orderBy: { position: 'asc' },
            }),
      ])

      const tasksInColumn = await ctx.prisma.task.findMany({
        where: { pageId: page.id, columnId: column.id, deletedAt: null },
        select: { position: true },
      })

      const task = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.task.create({
          data: {
            pageId: page.id,
            columnId: column.id,
            typeId: type?.id ?? null,
            priorityId: priority?.id ?? null,
            title: input.title,
            position: endPosition(tasksInColumn),
            createdById: ctx.user.id,
          },
        })
        await recordActivity(tx, { taskId: created.id, actorId: ctx.user.id, type: 'CREATED' })
        return created
      })

      kanbanBus.emit(page.id, { kind: 'task.created', taskId: task.id })
      return task
    }),
})
```

- [ ] **Step 4: Run, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-task.test.ts
```

Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/task.ts packages/trpc/test/kanban-task.test.ts
git commit -m "feat(kanban): task.create with default column/type/priority"
```

---

## Task 12: `kanban.task.update` (title / description / dates)

**Files:**
- Modify: `packages/trpc/src/routers/kanban/task.ts`
- Modify: `packages/trpc/test/kanban-task.test.ts`

- [ ] **Step 1: Write failing test for `task.update`**

Append to `packages/trpc/test/kanban-task.test.ts`:

```typescript
describe('kanban.task.update', () => {
  it('updates title and writes RENAMED activity when title changes', async () => {
    const taskUpdate = vi.fn().mockResolvedValue({ id: 't-1', title: 'New' })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = { task: { update: taskUpdate }, taskActivity: { create: activityCreate } }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 't-1', pageId: PAGE_ID, title: 'Old', dueDate: null, startDate: null,
        }),
      },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.update({ pageId: PAGE_ID, id: 't-1', title: 'New' })

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1' },
        data: expect.objectContaining({ title: 'New', updatedById: USER_ID }),
      }),
    )
    expect(activityCreate).toHaveBeenCalledWith({
      data: { taskId: 't-1', actorId: USER_ID, type: 'RENAMED', payload: undefined },
    })
  })

  it('writes DUE_DATE_CHANGED activity with from/to payload', async () => {
    const taskUpdate = vi.fn().mockResolvedValue({ id: 't-1' })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = { task: { update: taskUpdate }, taskActivity: { create: activityCreate } }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 't-1', pageId: PAGE_ID, title: 'X',
          dueDate: new Date('2026-05-15'), startDate: null,
        }),
      },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const newDue = new Date('2026-05-20')
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.update({ pageId: PAGE_ID, id: 't-1', dueDate: newDue })

    expect(activityCreate).toHaveBeenCalledWith({
      data: {
        taskId: 't-1',
        actorId: USER_ID,
        type: 'DUE_DATE_CHANGED',
        payload: { from: '2026-05-15T00:00:00.000Z', to: '2026-05-20T00:00:00.000Z' },
      },
    })
  })
})
```

- [ ] **Step 2: Run, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-task.test.ts
```

- [ ] **Step 3: Implement `task.update`**

Append inside `taskRouter` in `packages/trpc/src/routers/kanban/task.ts`:

```typescript
  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        description: z.unknown().optional(),
        startDate: z.date().nullable().optional(),
        dueDate: z.date().nullable().optional(),
        typeId: z.string().uuid().nullable().optional(),
        priorityId: z.string().uuid().nullable().optional(),
        sprintId: z.string().uuid().nullable().optional(),
        parentId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const current = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: {
          id: true, pageId: true, title: true,
          dueDate: true, startDate: true,
          typeId: true, priorityId: true, sprintId: true, parentId: true,
        },
      })
      if (current.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }

      const task = await ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.task.update({
          where: { id: input.id },
          data: {
            title: input.title,
            description: input.description as never,
            startDate: input.startDate,
            dueDate: input.dueDate,
            typeId: input.typeId,
            priorityId: input.priorityId,
            sprintId: input.sprintId,
            parentId: input.parentId,
            updatedById: ctx.user.id,
          },
        })

        if (input.title !== undefined && input.title !== current.title) {
          await recordActivity(tx, { taskId: current.id, actorId: ctx.user.id, type: 'RENAMED' })
        }
        if (input.description !== undefined) {
          await recordActivity(tx, { taskId: current.id, actorId: ctx.user.id, type: 'DESCRIPTION_CHANGED' })
        }
        if (input.dueDate !== undefined && !sameDate(current.dueDate, input.dueDate)) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'DUE_DATE_CHANGED',
            payload: { from: toIso(current.dueDate), to: toIso(input.dueDate) },
          })
        }
        if (input.startDate !== undefined && !sameDate(current.startDate, input.startDate)) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'START_DATE_CHANGED',
            payload: { from: toIso(current.startDate), to: toIso(input.startDate) },
          })
        }
        if (input.typeId !== undefined && input.typeId !== current.typeId) {
          await recordActivity(tx, {
            taskId: current.id, actorId: ctx.user.id, type: 'TYPE_CHANGED',
            payload: { fromId: current.typeId, toId: input.typeId },
          })
        }
        if (input.priorityId !== undefined && input.priorityId !== current.priorityId) {
          await recordActivity(tx, {
            taskId: current.id, actorId: ctx.user.id, type: 'PRIORITY_CHANGED',
            payload: { fromId: current.priorityId, toId: input.priorityId },
          })
        }
        if (input.sprintId !== undefined && input.sprintId !== current.sprintId) {
          await recordActivity(tx, {
            taskId: current.id, actorId: ctx.user.id, type: 'SPRINT_CHANGED',
            payload: { fromId: current.sprintId, toId: input.sprintId },
          })
        }
        if (input.parentId !== undefined && input.parentId !== current.parentId) {
          await recordActivity(tx, {
            taskId: current.id, actorId: ctx.user.id, type: 'PARENT_CHANGED',
            payload: { fromId: current.parentId, toId: input.parentId },
          })
        }
        return updated
      })

      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: task.id })
      return task
    }),
```

Add these helpers at the bottom of the same file:

```typescript
function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.getTime() === b.getTime()
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}
```

- [ ] **Step 4: Run, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-task.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/task.ts packages/trpc/test/kanban-task.test.ts
git commit -m "feat(kanban): task.update with activity-log deltas"
```

---

## Task 13: `kanban.task.move`

**Files:**
- Modify: `packages/trpc/src/routers/kanban/task.ts`
- Modify: `packages/trpc/test/kanban-task.test.ts`

- [ ] **Step 1: Write failing test for move + STATUS_CHANGED emission**

Append:

```typescript
describe('kanban.task.move', () => {
  it('updates columnId + position, writes MOVED, adds STATUS_CHANGED when kind differs', async () => {
    const taskUpdate = vi.fn().mockResolvedValue({ id: 't-1' })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = { task: { update: taskUpdate }, taskActivity: { create: activityCreate } }

    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 't-1', pageId: PAGE_ID, columnId: 'col-todo',
        }),
        findMany: vi.fn().mockResolvedValue([{ id: 't-2', position: 1024 }]),
      },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'col-todo', title: 'Todo', kind: 'ACTIVE' },
          { id: 'col-done', title: 'Done', kind: 'DONE' },
        ]),
      },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.move({
      pageId: PAGE_ID,
      id: 't-1',
      targetColumnId: 'col-done',
      beforeId: null,
      afterId: null,
    })

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1' },
        data: expect.objectContaining({ columnId: 'col-done' }),
      }),
    )
    const activityCalls = activityCreate.mock.calls.map((c) => c[0].data.type)
    expect(activityCalls).toContain('MOVED')
    expect(activityCalls).toContain('STATUS_CHANGED')
  })

  it('does NOT add STATUS_CHANGED when source and target have same kind', async () => {
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { update: vi.fn().mockResolvedValue({ id: 't-1' }) },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 't-1', pageId: PAGE_ID, columnId: 'col-a' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'col-a', title: 'A', kind: 'ACTIVE' },
          { id: 'col-b', title: 'B', kind: 'ACTIVE' },
        ]),
      },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.move({ pageId: PAGE_ID, id: 't-1', targetColumnId: 'col-b', beforeId: null, afterId: null })

    const types = activityCreate.mock.calls.map((c) => c[0].data.type)
    expect(types).toContain('MOVED')
    expect(types).not.toContain('STATUS_CHANGED')
  })
})
```

- [ ] **Step 2: Run, see RED**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-task.test.ts
```

- [ ] **Step 3: Implement `task.move`**

Append to `taskRouter`:

```typescript
  move: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        targetColumnId: z.string().uuid(),
        beforeId: z.string().uuid().nullable(),
        afterId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const current = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, pageId: true, columnId: true },
      })
      if (current.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }

      const columns = await ctx.prisma.kanbanColumn.findMany({
        where: { pageId: page.id },
        select: { id: true, title: true, kind: true },
      })
      const fromColumn = columns.find((c) => c.id === current.columnId)
      const toColumn = columns.find((c) => c.id === input.targetColumnId)
      if (!toColumn) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Колонка назначения не найдена' })
      }

      const tasksInTarget = await ctx.prisma.task.findMany({
        where: {
          pageId: page.id,
          columnId: input.targetColumnId,
          deletedAt: null,
          NOT: { id: input.id },
        },
        select: { id: true, position: true },
      })
      const prev = input.beforeId ? tasksInTarget.find((t) => t.id === input.beforeId)?.position ?? null : null
      const next = input.afterId ? tasksInTarget.find((t) => t.id === input.afterId)?.position ?? null : null
      const position = positionBetween(prev, next)

      const task = await ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.task.update({
          where: { id: input.id },
          data: { columnId: input.targetColumnId, position, updatedById: ctx.user.id },
        })
        await recordActivity(tx, {
          taskId: current.id,
          actorId: ctx.user.id,
          type: 'MOVED',
          payload: {
            fromColumnId: current.columnId,
            toColumnId: input.targetColumnId,
            fromColumnTitle: fromColumn?.title ?? null,
            toColumnTitle: toColumn.title,
          },
        })
        if (fromColumn && fromColumn.kind !== toColumn.kind) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'STATUS_CHANGED',
            payload: { fromKind: fromColumn.kind, toKind: toColumn.kind },
          })
        }
        return updated
      })

      kanbanBus.emit(page.id, { kind: 'task.moved', taskId: task.id })
      return task
    }),
```

Add `import { positionBetween } from './helpers'` to the top of `task.ts`.

- [ ] **Step 4: Run, see GREEN**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-task.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/task.ts packages/trpc/test/kanban-task.test.ts
git commit -m "feat(kanban): task.move with MOVED + STATUS_CHANGED activity"
```

---

## Task 14: `kanban.task.setAssignees` and `setLabels`

**Files:**
- Modify: `packages/trpc/src/routers/kanban/task.ts`
- Modify: `packages/trpc/test/kanban-task.test.ts`

- [ ] **Step 1: Write failing test for diff-based assignee changes**

Append:

```typescript
describe('kanban.task.setAssignees', () => {
  it('diffs against current: writes UNASSIGNED for removed, ASSIGNED for added', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      taskAssignee: { createMany, deleteMany },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 't-1', pageId: PAGE_ID,
          assignees: [{ userId: 'user-old' }],
        }),
      },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.setAssignees({ pageId: PAGE_ID, id: 't-1', userIds: ['user-new'] })

    expect(deleteMany).toHaveBeenCalledWith({
      where: { taskId: 't-1', userId: { in: ['user-old'] } },
    })
    expect(createMany).toHaveBeenCalledWith({
      data: [{ taskId: 't-1', userId: 'user-new' }],
    })
    const types = activityCreate.mock.calls.map((c) => c[0].data.type)
    expect(types).toEqual(expect.arrayContaining(['UNASSIGNED', 'ASSIGNED']))
  })
})
```

- [ ] **Step 2: Run, see RED**

- [ ] **Step 3: Implement `setAssignees` and `setLabels`**

Append:

```typescript
  setAssignees: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        userIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const current = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, pageId: true, assignees: { select: { userId: true } } },
      })
      if (current.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      const currentIds = new Set(current.assignees.map((a) => a.userId))
      const targetIds = new Set(input.userIds)
      const toRemove = [...currentIds].filter((id) => !targetIds.has(id))
      const toAdd = [...targetIds].filter((id) => !currentIds.has(id))

      await ctx.prisma.$transaction(async (tx) => {
        if (toRemove.length > 0) {
          await tx.taskAssignee.deleteMany({
            where: { taskId: input.id, userId: { in: toRemove } },
          })
          for (const userId of toRemove) {
            await recordActivity(tx, {
              taskId: input.id, actorId: ctx.user.id, type: 'UNASSIGNED', payload: { userId },
            })
          }
        }
        if (toAdd.length > 0) {
          await tx.taskAssignee.createMany({
            data: toAdd.map((userId) => ({ taskId: input.id, userId })),
          })
          for (const userId of toAdd) {
            await recordActivity(tx, {
              taskId: input.id, actorId: ctx.user.id, type: 'ASSIGNED', payload: { userId },
            })
          }
        }
      })

      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: input.id })
      return { ok: true as const }
    }),

  setLabels: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        labelIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const current = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, pageId: true, labels: { select: { labelId: true } } },
      })
      if (current.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      const currentIds = new Set(current.labels.map((l) => l.labelId))
      const targetIds = new Set(input.labelIds)
      const toRemove = [...currentIds].filter((id) => !targetIds.has(id))
      const toAdd = [...targetIds].filter((id) => !currentIds.has(id))

      await ctx.prisma.$transaction(async (tx) => {
        if (toRemove.length > 0) {
          await tx.kanbanLabelOnTask.deleteMany({
            where: { taskId: input.id, labelId: { in: toRemove } },
          })
          for (const labelId of toRemove) {
            await recordActivity(tx, {
              taskId: input.id, actorId: ctx.user.id, type: 'UNLABELED', payload: { labelId },
            })
          }
        }
        if (toAdd.length > 0) {
          await tx.kanbanLabelOnTask.createMany({
            data: toAdd.map((labelId) => ({ taskId: input.id, labelId })),
          })
          for (const labelId of toAdd) {
            await recordActivity(tx, {
              taskId: input.id, actorId: ctx.user.id, type: 'LABELED', payload: { labelId },
            })
          }
        }
      })

      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: input.id })
      return { ok: true as const }
    }),
```

- [ ] **Step 4: Run, see GREEN**

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/task.ts packages/trpc/test/kanban-task.test.ts
git commit -m "feat(kanban): task.setAssignees and setLabels with diff activity"
```

---

## Task 15: `kanban.task.softDelete` with permissions

**Files:**
- Modify: `packages/trpc/src/routers/kanban/task.ts`
- Modify: `packages/trpc/test/kanban-task.test.ts`

- [ ] **Step 1: Write failing tests for permission matrix**

Append:

```typescript
describe('kanban.task.softDelete', () => {
  it('allows the task creator to soft-delete', async () => {
    const update = vi.fn().mockResolvedValue({ id: 't-1' })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 't-1', pageId: PAGE_ID, createdById: USER_ID,
        }),
        update,
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.softDelete({ pageId: PAGE_ID, id: 't-1' })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
  })

  it('allows workspace OWNER to soft-delete someone else’s task', async () => {
    const update = vi.fn().mockResolvedValue({ id: 't-1' })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 't-1', pageId: PAGE_ID, createdById: 'someone-else',
        }),
        update,
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.softDelete({ pageId: PAGE_ID, id: 't-1' })

    expect(update).toHaveBeenCalled()
  })

  it('forbids a non-OWNER non-creator', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 't-1', pageId: PAGE_ID, createdById: 'someone-else',
        }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await expect(caller.softDelete({ pageId: PAGE_ID, id: 't-1' })).rejects.toThrow(/прав/i)
  })
})
```

- [ ] **Step 2: Run, see RED**

- [ ] **Step 3: Implement `softDelete`**

Append:

```typescript
  softDelete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const task = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, pageId: true, createdById: true },
      })
      if (task.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
      })
      const isOwner = member?.role === 'OWNER'
      const isCreator = task.createdById === ctx.user.id
      if (!isOwner && !isCreator) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на удаление задачи' })
      }

      await ctx.prisma.task.update({
        where: { id: input.id },
        data: { deletedAt: new Date(), updatedById: ctx.user.id },
      })
      kanbanBus.emit(page.id, { kind: 'task.deleted', taskId: input.id })
      return { ok: true as const }
    }),
```

- [ ] **Step 4: Run, see GREEN**

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/kanban/task.ts packages/trpc/test/kanban-task.test.ts
git commit -m "feat(kanban): task.softDelete with creator-or-OWNER permission"
```

---

## Task 16: `kanban.events.subscribe` SSE

**Files:**
- Create: `packages/trpc/src/routers/kanban/events.ts`

There is no easy unit test for an `AsyncIterable` subscription resolver; the integration is covered by the E2E in Task 28. Implementation only.

- [ ] **Step 1: Implement**

```typescript
// packages/trpc/src/routers/kanban/events.ts
import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { kanbanBus, type KanbanEvent } from '../../realtime/kanban-bus'

export const eventsRouter = router({
  subscribe: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .subscription(async function* ({ ctx, input, signal }) {
      await assertPageAccess(ctx, input.pageId)

      const queue: KanbanEvent[] = []
      let resolveNext: ((value: KanbanEvent) => void) | null = null

      const unsubscribe = kanbanBus.on(input.pageId, (event) => {
        if (resolveNext) {
          const r = resolveNext
          resolveNext = null
          r(event)
        } else {
          queue.push(event)
        }
      })

      const onAbort = () => {
        unsubscribe()
        if (resolveNext) {
          const r = resolveNext
          resolveNext = null
          r({ kind: 'task.updated', taskId: '00000000-0000-0000-0000-000000000000' })
        }
      }
      signal?.addEventListener('abort', onAbort)

      try {
        while (!signal?.aborted) {
          if (queue.length > 0) {
            yield queue.shift()!
            continue
          }
          const event = await new Promise<KanbanEvent>((resolve) => {
            resolveNext = resolve
          })
          if (signal?.aborted) break
          yield event
        }
      } finally {
        unsubscribe()
        signal?.removeEventListener('abort', onAbort)
      }
    }),
})
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/kanban/events.ts
git commit -m "feat(kanban): events.subscribe SSE endpoint"
```

---

## Task 17: Mount `kanban` router + seed defaults in `page.create`

**Files:**
- Create: `packages/trpc/src/routers/kanban/index.ts`
- Modify: `packages/trpc/src/index.ts` (or `appRouter` file — confirm with `grep "pageRouter" packages/trpc/src/`)
- Modify: `packages/trpc/src/routers/page.ts`

- [ ] **Step 1: Create aggregator**

```typescript
// packages/trpc/src/routers/kanban/index.ts
import { router } from '../../trpc'

import { boardRouter } from './board'
import { columnRouter } from './column'
import { typeRouter } from './type'
import { priorityRouter } from './priority'
import { labelRouter } from './label'
import { taskRouter } from './task'
import { eventsRouter } from './events'

export const kanbanRouter = router({
  board: boardRouter,
  column: columnRouter,
  type: typeRouter,
  priority: priorityRouter,
  label: labelRouter,
  task: taskRouter,
  events: eventsRouter,
})
```

- [ ] **Step 2: Mount in `appRouter`**

Locate the `appRouter` definition (likely `packages/trpc/src/index.ts` or `packages/trpc/src/routers/_app.ts`). Add:

```typescript
import { kanbanRouter } from './routers/kanban'

export const appRouter = router({
  // ... existing
  kanban: kanbanRouter,
})
```

- [ ] **Step 3: Extend `page.create` to seed defaults for KANBAN**

In `packages/trpc/src/routers/page.ts`, locate the `create` mutation. Wrap the existing logic in a transaction (if not already) and add after the page row is created:

```typescript
import { seedKanbanDefaults } from './kanban/helpers'

// ... inside create mutation, after `prisma.page.create({...})`:
if (input.type === 'KANBAN') {
  await seedKanbanDefaults(tx, page.id)
}
```

If the current implementation doesn't use `$transaction`, refactor: pass the existing `prisma` operations through `prisma.$transaction(async tx => { ... })`. The seed must run in the same transaction.

- [ ] **Step 4: Write test confirming seeding**

In `packages/trpc/test/page-router.test.ts` (create the file if it doesn't exist; otherwise append):

```typescript
import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID, email: 't@e.com', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

describe('page.create with type KANBAN', () => {
  it('seeds 3 columns + 2 types + 5 priorities in the same tx', async () => {
    const columnCreateMany = vi.fn().mockResolvedValue({})
    const typeCreateMany = vi.fn().mockResolvedValue({})
    const priorityCreateMany = vi.fn().mockResolvedValue({})

    const txClient = {
      page: {
        create: vi.fn().mockResolvedValue({ id: 'page-1', workspaceId: WORKSPACE_ID, type: 'KANBAN' }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) },
      kanbanColumn: { createMany: columnCreateMany },
      kanbanType: { createMany: typeCreateMany },
      kanbanPriority: { createMany: priorityCreateMany },
    }
    const prisma = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(pageRouter)(ctx(prisma))
    await caller.create({ workspaceId: WORKSPACE_ID, type: 'KANBAN' as never })

    expect(columnCreateMany).toHaveBeenCalled()
    expect(typeCreateMany).toHaveBeenCalled()
    expect(priorityCreateMany).toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run all kanban + page tests**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-*.test.ts packages/trpc/test/page-router.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/routers/kanban/index.ts packages/trpc/src/index.ts packages/trpc/src/routers/page.ts packages/trpc/test/page-router.test.ts
git commit -m "feat(kanban): mount router and seed defaults on page.create"
```

---

## Task 18: Add `@hello-pangea/dnd` and re-export `ViewKanbanIcon`

**Files:**
- Modify: `apps/web/package.json`
- Modify: `packages/ui/src/components/index.ts`

- [ ] **Step 1: Add dependency**

```bash
pnpm --filter web add @hello-pangea/dnd@^17
```

(Use latest 17.x; 18.x requires React 19 — already on React 19, so 18.x is also fine; pick whichever resolves cleanly with `pnpm install`.)

- [ ] **Step 2: Re-export icon**

Append to `packages/ui/src/components/index.ts`:

```typescript
export { default as ViewKanbanIcon } from '@mui/icons-material/ViewKanban'
```

Maintain the alphabetical order with the existing icon block if one exists.

- [ ] **Step 3: Type check**

```bash
pnpm check-types
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml packages/ui/src/components/index.ts
git commit -m "chore(deps): add @hello-pangea/dnd and ViewKanban icon re-export"
```

---

## Task 19: Wire `httpSubscriptionLink` into tRPC client

**Files:**
- Modify: `apps/web/src/trpc/client.tsx`

- [ ] **Step 1: Inspect current links**

```bash
cat apps/web/src/trpc/client.tsx | head -60
```

- [ ] **Step 2: Replace the link chain**

In `apps/web/src/trpc/client.tsx`, find the `links: [...]` array (currently probably `[httpBatchLink({ url: '/api/trpc' })]`) and replace with:

```typescript
import {
  createTRPCReact,
  httpBatchLink,
  httpSubscriptionLink,
  loggerLink,
  splitLink,
} from '@trpc/react-query'

// ...

links: [
  loggerLink({
    enabled: (op) =>
      process.env.NODE_ENV === 'development' ||
      (op.direction === 'down' && op.result instanceof Error),
  }),
  splitLink({
    condition: (op) => op.type === 'subscription',
    true: httpSubscriptionLink({ url: '/api/trpc' }),
    false: httpBatchLink({ url: '/api/trpc' }),
  }),
],
```

(If `httpSubscriptionLink` is not exported from `@trpc/react-query`, import from `@trpc/client` instead — `@trpc/react-query` re-exports many links, but subscription links live in `@trpc/client`. Verify by reading `node_modules/@trpc/react-query/dist/index.d.ts` for the export.)

- [ ] **Step 3: Verify**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/trpc/client.tsx
git commit -m "feat(web): enable tRPC subscriptions via httpSubscriptionLink"
```

---

## Task 20: Page tree menu + renderer dispatch + fullBleed + page-actions menu unions

**Files:**
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx`
- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`
- Modify: `apps/web/src/components/page/page-actions-toolbar.tsx`
- Modify: `apps/web/src/components/page/page-actions-menu.tsx`

- [ ] **Step 1: Extend `CreatablePageType` and menu entry**

In `page-tree-section.tsx`:
- Change `type CreatablePageType = Extract<PageType, 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM'>` to include `'KANBAN'`.
- Add `import { ViewKanbanIcon } from '@repo/ui/components'`.
- In the menu array (where TEXT / EXCALIDRAW / GENOGRAM entries live), add:

```tsx
{
  type: 'KANBAN',
  label: 'Канбан',
  icon: <ViewKanbanIcon fontSize="small" />,
},
```

- [ ] **Step 2: Extend type unions in `page-actions-toolbar.tsx` and `page-actions-menu.tsx`**

For each file, find the local `type` union (something like `'TEXT' | 'EXCALIDRAW' | 'GENOGRAM'`) and add `| 'KANBAN'`. Keep behaviour identical to the existing fallbacks.

- [ ] **Step 3: Add KANBAN dispatch in `page-renderer.tsx`**

Before the final fallback (the `Box` with "Тип страницы ... пока не поддерживается"):

```tsx
import dynamic from 'next/dynamic'

const KanbanBoardPage = dynamic(
  () => import('@/components/kanban/kanban-board-page').then((m) => m.KanbanBoardPage),
  { ssr: false, loading: () => null },
)

// ...

if (page.type === 'KANBAN') {
  return <KanbanBoardPage pageId={page.id} workspaceId={page.workspaceId} />
}
```

(`dynamic` import lives at top of file; the `if` block goes in the same place as the existing `if (page.type === 'EXCALIDRAW')`.)

- [ ] **Step 4: Add KANBAN to `isFullBleed`**

In `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`:

```typescript
const isFullBleed =
  page.type === 'EXCALIDRAW' || page.type === 'GENOGRAM' || page.type === 'KANBAN'
```

- [ ] **Step 5: Type check**

```bash
pnpm --filter web check-types
```

Expected: passes. If `KanbanBoardPage` is unresolved, that's expected — we create it in Task 22; this task just wires the dispatch.

- [ ] **Step 6: Commit (skip-checks for placeholder import — see note)**

The page-renderer import to a not-yet-existing file means typecheck may fail. We can either:

(a) **Stub the component first** — write an empty `kanban-board-page.tsx` exporting `KanbanBoardPage = () => null` and commit together with this task. This keeps the typecheck green.

(b) **Defer this commit** until after Task 22.

Choose (a). Create:

```tsx
// apps/web/src/components/kanban/kanban-board-page.tsx
'use client'

interface KanbanBoardPageProps {
  pageId: string
  workspaceId: string
}

export function KanbanBoardPage(_props: KanbanBoardPageProps) {
  return null
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/workspace/page-tree-section.tsx apps/web/src/components/page/page-renderer.tsx apps/web/src/app/\(protected\)/workspaces apps/web/src/components/page/page-actions-toolbar.tsx apps/web/src/components/page/page-actions-menu.tsx apps/web/src/components/kanban/kanban-board-page.tsx
git commit -m "feat(web): wire KANBAN page type into renderer, tree menu, fullBleed"
```

---

## Task 21: Float position helpers for the client

**Files:**
- Create: `apps/web/src/components/kanban/lib/positions.ts`

The client computes optimistic positions before mutations land. Duplicating the server logic is acceptable because the math is trivial and isolated; alternatively, this could live in `@repo/trpc/shared` — for P1, duplicate.

- [ ] **Step 1: Implement**

```typescript
// apps/web/src/components/kanban/lib/positions.ts
const POSITION_GAP = 1024

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) return prev + (next - prev) / 2
  if (prev !== null) return prev + POSITION_GAP
  if (next !== null) return next - POSITION_GAP
  return 0
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/kanban/lib/positions.ts
git commit -m "feat(kanban-ui): client-side position helper"
```

---

## Task 22: `KanbanBoardPage` shell with `getBoard` query

**Files:**
- Modify: `apps/web/src/components/kanban/kanban-board-page.tsx`

- [ ] **Step 1: Replace stub with real shell**

```tsx
// apps/web/src/components/kanban/kanban-board-page.tsx
'use client'

import { useSearchParams } from 'next/navigation'
import { Box, CircularProgress, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { KanbanToolbar } from './kanban-toolbar'
import { BoardView } from './views/board-view'
import { TaskDetailContainer } from './task/task-detail-container'
import { useKanbanEvents } from './realtime/use-kanban-events'

interface KanbanBoardPageProps {
  pageId: string
  workspaceId: string
}

export function KanbanBoardPage({ pageId, workspaceId }: KanbanBoardPageProps) {
  const { data, isLoading, error } = trpc.kanban.board.getBoard.useQuery({ pageId })

  useKanbanEvents({ pageId })

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }
  if (error || !data) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">Не удалось загрузить доску: {error?.message}</Typography>
      </Box>
    )
  }

  return (
    <Stack sx={{ height: '100vh', overflow: 'hidden' }}>
      <KanbanToolbar pageId={pageId} workspaceId={workspaceId} />
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <BoardView pageId={pageId} board={data} />
      </Box>
      <TaskDetailContainer pageId={pageId} board={data} />
    </Stack>
  )
}
```

- [ ] **Step 2: Commit (will fail typecheck until later tasks; commit at end of Task 27)**

Don't commit yet — leave uncommitted until subordinate components exist (Tasks 23-27). Add a TODO note in the assistant message.

---

## Task 23: `KanbanToolbar` with Create Task button

**Files:**
- Create: `apps/web/src/components/kanban/kanban-toolbar.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/components/kanban/kanban-toolbar.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Button, IconButton, Stack, Typography } from '@repo/ui/components'
import AddIcon from '@mui/icons-material/Add'

import { trpc } from '@/trpc/client'

interface KanbanToolbarProps {
  pageId: string
  workspaceId: string
}

export function KanbanToolbar({ pageId }: KanbanToolbarProps) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const createTask = trpc.kanban.task.create.useMutation({
    onSuccess: async (task) => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      const params = new URLSearchParams(window.location.search)
      params.set('taskId', task.id)
      router.replace(`?${params.toString()}`)
    },
  })
  const [busy, setBusy] = useState(false)

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
    >
      <Box>
        <Typography variant="h6">Канбан</Typography>
      </Box>
      <Button
        variant="contained"
        startIcon={<AddIcon />}
        disabled={busy || createTask.isPending}
        onClick={async () => {
          setBusy(true)
          try {
            await createTask.mutateAsync({ pageId, title: 'Новая задача' })
          } finally {
            setBusy(false)
          }
        }}
      >
        Создать задачу
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 2: Commit at end of UI chain (Task 27)**

---

## Task 24: `BoardView` with `DragDropContext`

**Files:**
- Create: `apps/web/src/components/kanban/views/board-view.tsx`
- Create: `apps/web/src/components/kanban/views/board-column.tsx`
- Create: `apps/web/src/components/kanban/views/board-card.tsx`

- [ ] **Step 1: Implement column shell**

```tsx
// apps/web/src/components/kanban/views/board-column.tsx
'use client'

import { Droppable } from '@hello-pangea/dnd'
import { Box, Paper, Stack, Typography } from '@repo/ui/components'

import type { BoardColumnData } from '../types'
import { BoardCard } from './board-card'

interface BoardColumnProps {
  column: BoardColumnData
}

export function BoardColumn({ column }: BoardColumnProps) {
  return (
    <Paper variant="outlined" sx={{ width: 320, flexShrink: 0, p: 1.5, bgcolor: 'background.default' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">{column.title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {column.tasks.length}
        </Typography>
      </Stack>
      <Droppable droppableId={column.id}>
        {(provided) => (
          <Box ref={provided.innerRef} {...provided.droppableProps} sx={{ minHeight: 40 }}>
            {column.tasks.map((task, index) => (
              <BoardCard key={task.id} task={task} index={index} />
            ))}
            {provided.placeholder}
          </Box>
        )}
      </Droppable>
    </Paper>
  )
}
```

- [ ] **Step 2: Implement card preview**

```tsx
// apps/web/src/components/kanban/views/board-card.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Draggable } from '@hello-pangea/dnd'
import { Box, Card, Stack, Typography } from '@repo/ui/components'

import type { BoardTaskData } from '../types'

interface BoardCardProps {
  task: BoardTaskData
  index: number
}

export function BoardCard({ task, index }: BoardCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function openDetail() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('taskId', task.id)
    router.replace(`?${params.toString()}`)
  }

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <Card
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={openDetail}
          sx={{
            mb: 1,
            p: 1.25,
            cursor: 'pointer',
            boxShadow: snapshot.isDragging ? 4 : 0,
          }}
        >
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {task.title}
          </Typography>
          {task.dueDate ? (
            <Typography variant="caption" color="text.secondary">
              до {new Date(task.dueDate).toLocaleDateString('ru-RU')}
            </Typography>
          ) : null}
          {task.assignees.length > 0 ? (
            <Stack direction="row" spacing={-0.5} sx={{ mt: 0.5 }}>
              {task.assignees.slice(0, 3).map((a) => (
                <Box
                  key={a.user.id}
                  sx={{
                    width: 24,
                    height: 24,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    border: 2,
                    borderColor: 'background.paper',
                  }}
                >
                  {(a.user.firstName?.[0] ?? a.user.email[0]).toUpperCase()}
                </Box>
              ))}
            </Stack>
          ) : null}
        </Card>
      )}
    </Draggable>
  )
}
```

- [ ] **Step 3: Implement board-view with DnD wiring**

```tsx
// apps/web/src/components/kanban/views/board-view.tsx
'use client'

import { useMemo } from 'react'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { BoardColumn } from './board-column'
import type { BoardData, BoardColumnData } from '../types'
import { positionBetween } from '../lib/positions'

interface BoardViewProps {
  pageId: string
  board: BoardData
}

export function BoardView({ pageId, board }: BoardViewProps) {
  const utils = trpc.useUtils()
  const moveTask = trpc.kanban.task.move.useMutation({
    onError: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const columnsWithTasks = useMemo<BoardColumnData[]>(() => {
    return board.columns.map((c) => ({
      ...c,
      tasks: board.tasks
        .filter((t) => t.columnId === c.id)
        .sort((a, b) => a.position - b.position),
    }))
  }, [board])

  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const sourceColId = result.source.droppableId
    const destColId = result.destination.droppableId
    const taskId = result.draggableId
    if (sourceColId === destColId && result.source.index === result.destination.index) return

    const destCol = columnsWithTasks.find((c) => c.id === destColId)
    if (!destCol) return
    const destTasksWithoutMoved = destCol.tasks.filter((t) => t.id !== taskId)
    const before = destTasksWithoutMoved[result.destination.index - 1] ?? null
    const after = destTasksWithoutMoved[result.destination.index] ?? null

    // Optimistic update
    utils.kanban.board.getBoard.setData({ pageId }, (prev) => {
      if (!prev) return prev
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                columnId: destColId,
                position: positionBetween(before?.position ?? null, after?.position ?? null),
              }
            : t,
        ),
      }
    })

    await moveTask.mutateAsync({
      pageId,
      id: taskId,
      targetColumnId: destColId,
      beforeId: before?.id ?? null,
      afterId: after?.id ?? null,
    })
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Stack direction="row" spacing={2} sx={{ height: '100%', overflowX: 'auto', pb: 2 }}>
        {columnsWithTasks.map((column) => (
          <BoardColumn key={column.id} column={column} />
        ))}
      </Stack>
    </DragDropContext>
  )
}
```

- [ ] **Step 4: Define shared types**

```typescript
// apps/web/src/components/kanban/types.ts
import type { RouterOutputs } from '@/trpc/client'

export type BoardData = RouterOutputs['kanban']['board']['getBoard']
export type BoardTaskData = BoardData['tasks'][number]
export type BoardColumnData = BoardData['columns'][number] & { tasks: BoardTaskData[] }
```

(`RouterOutputs` is the standard tRPC v11 type helper. If `apps/web/src/trpc/client.tsx` doesn't currently re-export it, add `export type RouterOutputs = inferRouterOutputs<AppRouter>` next to the trpc client object.)

- [ ] **Step 5: Commit at end of UI chain (Task 27)**

---

## Task 25: `TaskDetailContainer` + `TaskDetailModal` + `TaskForm`

**Files:**
- Create: `apps/web/src/components/kanban/task/task-detail-container.tsx`
- Create: `apps/web/src/components/kanban/task/task-detail-modal.tsx`
- Create: `apps/web/src/components/kanban/task/task-form.tsx`

- [ ] **Step 1: Implement form (P1 fields only: title, assignees, due date)**

```tsx
// apps/web/src/components/kanban/task/task-form.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Box,
  Checkbox,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import type { BoardData, BoardTaskData } from '../types'

interface TaskFormProps {
  pageId: string
  task: BoardTaskData
  members: BoardData['members']
}

export function TaskForm({ pageId, task, members }: TaskFormProps) {
  const utils = trpc.useUtils()
  const updateTask = trpc.kanban.task.update.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })
  const setAssignees = trpc.kanban.task.setAssignees.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  const [title, setTitle] = useState(task.title)
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task.assignees.map((a) => a.user.id),
  )
  const [dueDate, setDueDate] = useState<string>(
    task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '',
  )

  useEffect(() => {
    setTitle(task.title)
    setAssigneeIds(task.assignees.map((a) => a.user.id))
    setDueDate(task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '')
  }, [task.id, task.title, task.assignees, task.dueDate])

  return (
    <Stack spacing={2}>
      <TextField
        label="Название"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== task.title) updateTask.mutate({ pageId, id: task.id, title })
        }}
        fullWidth
      />

      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Исполнители
        </Typography>
        <Select
          multiple
          value={assigneeIds}
          onChange={(e) => {
            const value = Array.isArray(e.target.value) ? e.target.value : [e.target.value]
            setAssigneeIds(value)
            setAssignees.mutate({ pageId, id: task.id, userIds: value })
          }}
          renderValue={(selected) => {
            const sel = selected as string[]
            return members
              .filter((m) => sel.includes(m.user.id))
              .map((m) => `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email)
              .join(', ')
          }}
          fullWidth
          size="small"
        >
          {members.map((m) => (
            <MenuItem key={m.user.id} value={m.user.id}>
              <Checkbox checked={assigneeIds.includes(m.user.id)} />
              <ListItemText
                primary={
                  `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email
                }
              />
            </MenuItem>
          ))}
        </Select>
      </Box>

      <TextField
        label="Срок"
        type="date"
        value={dueDate}
        InputLabelProps={{ shrink: true }}
        onChange={(e) => setDueDate(e.target.value)}
        onBlur={() => {
          const newValue = dueDate ? new Date(dueDate) : null
          updateTask.mutate({ pageId, id: task.id, dueDate: newValue })
        }}
      />
    </Stack>
  )
}
```

- [ ] **Step 2: Implement modal**

```tsx
// apps/web/src/components/kanban/task/task-detail-modal.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
} from '@repo/ui/components'
import CloseIcon from '@mui/icons-material/Close'

import type { BoardData, BoardTaskData } from '../types'
import { TaskForm } from './task-form'

interface TaskDetailModalProps {
  pageId: string
  task: BoardTaskData
  members: BoardData['members']
}

export function TaskDetailModal({ pageId, task, members }: TaskDetailModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function close() {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('taskId')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : window.location.pathname)
  }

  return (
    <Dialog open onClose={close} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Stack>Задача</Stack>
        <IconButton onClick={close}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <TaskForm pageId={pageId} task={task} members={members} />
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Implement container that reads `?taskId`**

```tsx
// apps/web/src/components/kanban/task/task-detail-container.tsx
'use client'

import { useSearchParams } from 'next/navigation'

import type { BoardData } from '../types'
import { TaskDetailModal } from './task-detail-modal'

interface TaskDetailContainerProps {
  pageId: string
  board: BoardData
}

export function TaskDetailContainer({ pageId, board }: TaskDetailContainerProps) {
  const taskId = useSearchParams()?.get('taskId')
  if (!taskId) return null
  const task = board.tasks.find((t) => t.id === taskId)
  if (!task) return null
  return <TaskDetailModal pageId={pageId} task={task} members={board.members} />
}
```

- [ ] **Step 4: Commit at end of UI chain (Task 27)**

---

## Task 26: Realtime events hook

**Files:**
- Create: `apps/web/src/components/kanban/realtime/use-kanban-events.ts`

- [ ] **Step 1: Implement**

```typescript
// apps/web/src/components/kanban/realtime/use-kanban-events.ts
'use client'

import { trpc } from '@/trpc/client'

interface UseKanbanEventsArgs {
  pageId: string
}

export function useKanbanEvents({ pageId }: UseKanbanEventsArgs) {
  const utils = trpc.useUtils()

  trpc.kanban.events.subscribe.useSubscription(
    { pageId },
    {
      onData: () => {
        // P1: blunt invalidation per event. P2+ patches the cache surgically.
        void utils.kanban.board.getBoard.invalidate({ pageId })
      },
    },
  )
}
```

- [ ] **Step 2: Commit at end of UI chain (Task 27)**

---

## Task 27: Commit the full UI chain + verify dev server

**Files:** *(no new files; this task consolidates commits for Tasks 22-26)*

- [ ] **Step 1: Stage everything**

```bash
git add apps/web/src/components/kanban/kanban-board-page.tsx \
        apps/web/src/components/kanban/kanban-toolbar.tsx \
        apps/web/src/components/kanban/types.ts \
        apps/web/src/components/kanban/views/board-view.tsx \
        apps/web/src/components/kanban/views/board-column.tsx \
        apps/web/src/components/kanban/views/board-card.tsx \
        apps/web/src/components/kanban/task/task-detail-container.tsx \
        apps/web/src/components/kanban/task/task-detail-modal.tsx \
        apps/web/src/components/kanban/task/task-form.tsx \
        apps/web/src/components/kanban/realtime/use-kanban-events.ts
```

- [ ] **Step 2: Type check + lint**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: both pass. Fix any errors before committing.

- [ ] **Step 3: Smoke-test in dev server**

```bash
pnpm --filter web dev
```

Open `http://localhost:3000`, sign in, create a new KANBAN page from the sidebar. Verify:
- Three default columns appear: Todo, In Progress, Done.
- "Создать задачу" button creates a task → appears in the first column → opens a detail modal.
- Drag the card from Todo to In Progress; reload; card is still in In Progress.
- Open two browser windows side-by-side on the same page; create a task in window A → window B shows it within ~1 second.

If any check fails, debug before committing.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(kanban): board view with DnD, task detail modal, realtime"
```

---

## Task 28: E2E spec for P1 acceptance

**Files:**
- Create: `apps/e2e/kanban-board.spec.ts`

- [ ] **Step 1: Write spec**

```typescript
// apps/e2e/kanban-board.spec.ts
import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test.describe('KANBAN P1', () => {
  test('create board → DnD persists after reload → realtime across sessions', async ({ page, context, browser }) => {
    const user = await signUpAndAuthAs(page, { firstName: 'Kanban', lastName: 'Tester' })

    // Create a workspace if not auto-created
    await page.goto('/app')
    // ... (project convention: the test helper or fixtures set up a default workspace)

    // Create KANBAN page via tree sidebar
    await page.getByRole('button', { name: 'Создать страницу' }).first().click()
    await page.getByRole('menuitem', { name: 'Канбан' }).click()

    await expect(page.getByText('Todo')).toBeVisible()
    await expect(page.getByText('In Progress')).toBeVisible()
    await expect(page.getByText('Done')).toBeVisible()

    // Create a task
    await page.getByRole('button', { name: 'Создать задачу' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Название').fill('First task')
    await page.getByLabel('Название').blur()
    await page.keyboard.press('Escape')

    // The card should be in the first column
    const todoColumn = page.locator('[data-rbd-droppable-id]').first()
    await expect(todoColumn.getByText('First task')).toBeVisible()

    // DnD: move card from Todo to In Progress via @hello-pangea/dnd
    const card = page.getByText('First task').first()
    const inProgress = page.locator('[data-rbd-droppable-id]').nth(1)
    await card.dragTo(inProgress)

    // Reload
    await page.reload()
    await expect(inProgress.getByText('First task')).toBeVisible()

    // Realtime: open a second context, find the same board, and verify a new task appears
    const url = page.url()
    const otherContext = await browser.newContext({ storageState: await context.storageState() })
    const otherPage = await otherContext.newPage()
    await otherPage.goto(url)
    await expect(otherPage.getByText('First task')).toBeVisible()

    await page.getByRole('button', { name: 'Создать задачу' }).click()
    await page.getByLabel('Название').fill('Realtime task')
    await page.getByLabel('Название').blur()
    await page.keyboard.press('Escape')

    await expect(otherPage.getByText('Realtime task')).toBeVisible({ timeout: 5000 })

    await otherContext.close()
  })
})
```

(Notes: the exact selectors for "Создать страницу" and the tree sidebar depend on existing E2E patterns. Inspect `apps/e2e/helpers/auth.ts` and any existing page-creation E2E spec to match conventions. The `[data-rbd-droppable-id]` selector is `@hello-pangea/dnd`'s default test hook.)

- [ ] **Step 2: Run**

```bash
docker compose up -d
pnpm exec playwright test apps/e2e/kanban-board.spec.ts
```

Expected: PASS. If fails, debug each assertion individually.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/kanban-board.spec.ts
git commit -m "test(e2e): P1 acceptance for KANBAN board (DnD, reload, realtime)"
```

---

## Task 29: Run all gates and final smoke test

- [ ] **Step 1: Run full gates**

```bash
pnpm gates
```

Expected: lint + check-types + build + test all pass.

- [ ] **Step 2: Run all kanban tests in isolation**

```bash
pnpm --filter @repo/trpc test -- packages/trpc/test/kanban-
```

Expected: every kanban-prefixed test file passes.

- [ ] **Step 3: Manual smoke on dev**

Repeat the manual checks from Task 27, Step 3. Confirm:
1. Default 3 columns appear on KANBAN page creation.
2. Task created via toolbar lands in first column.
3. DnD between columns persists across reloads.
4. Assignee, due date editable via detail modal.
5. Two browser sessions on same board see each other's changes within ~1s.

- [ ] **Step 4: Final commit if any tweaks were needed**

If `pnpm gates` flagged anything, fix and commit. Otherwise, this task is just verification.

---

## Self-Review

**1. Spec coverage:**
- ✅ Schema (Task 1) — all enums, models, partial unique index
- ✅ `kanban.board.getBoard` (Task 6)
- ✅ Column router (Task 7), Type (8), Priority (9), Label (10) — all CRUD + reorder; column has delete-with-reassign + last-column guard
- ✅ Task `create`/`update`/`move`/`setAssignees`/`setLabels`/`softDelete` (Tasks 11-15)
- ✅ `events.subscribe` SSE (Task 16)
- ✅ Mount + seed (Task 17)
- ✅ Frontend dependency + icon (Task 18)
- ✅ tRPC client links (Task 19)
- ✅ Page tree menu, renderer, fullBleed, page-actions unions (Task 20)
- ✅ KanbanBoardPage + toolbar + board view + DnD (Tasks 21-24)
- ✅ Task detail modal + form (Task 25)
- ✅ Realtime hook (Task 26)
- ✅ E2E (Task 28)
- ✅ Gates (Task 29)

P1 acceptance criteria mapped:
- "Create board → 3 default columns" — Tasks 17 (seed) + 28 (E2E)
- "DnD between columns persists" — Tasks 13 (server) + 24 (client) + 28 (E2E)
- "Assignee + due date editable" — Task 25 (form)
- "Concurrent sessions see updates" — Tasks 2 (bus) + 16 (subscribe) + 26 (hook) + 28 (E2E)

**2. Placeholder scan:** No TBDs, no "TODO", no "implement later". All code blocks contain real code.

**3. Type consistency:**
- `KanbanBus` / `KanbanEvent` defined Task 2, consumed Tasks 6-17.
- `positionBetween` / `endPosition` defined Task 3, consumed Tasks 7-13. Same signature throughout.
- `recordActivity` / `seedKanbanDefaults` defined Task 4, consumed Tasks 11-17.
- `assertPageAccess` / `assertPageOwnership` extracted Task 5, consumed Tasks 6-15.
- `BoardData` / `BoardTaskData` defined Task 24, consumed Tasks 25-26.

No `clearLayers` vs `clearFullLayers` style mismatches detected.

**4. Outstanding implementation-time decisions** (acceptable; not placeholders):
- Whether `httpSubscriptionLink` exports from `@trpc/react-query` or `@trpc/client` (Task 19, Step 2 — engineer verifies).
- Exact text of "Создать страницу" button (Task 28, Step 1 — engineer adjusts selectors to match existing E2E patterns).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-kanban-page-type-p1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
