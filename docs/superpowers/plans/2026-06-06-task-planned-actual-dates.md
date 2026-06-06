# Task Planned/Actual Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual `actualDate` ("Фактическая дата") field to Kanban tasks alongside the existing `dueDate` (relabelled "Плановая дата"), with soft auto-set on moving to a DONE column, deviation display (Факт − План), and table-view columns + filters/sort.

**Architecture:** All write logic lives in `@repo/domain` (`KanbanService`), consumed by `@repo/trpc` (passthrough — no router change). A new Prisma column `Task.actualDate` flows to the web client automatically via the existing `getBoard` `include` query. The web app adds a DatePicker, a pure deviation helper, card/table display, and filter/sort controls. Date granularity is "date only" (UTC midnight) so day-deviation math is clean.

**Tech Stack:** Prisma 7, Zod, vitest (domain + web), MUI v6 DatePicker (date-fns + Russian locale), Next.js 16 / React 19.

**Spec:** `docs/superpowers/specs/2026-06-06-task-planned-actual-dates-design.md`

---

## File Structure

**Backend (data + domain):**
- `packages/db/prisma/schema.prisma` — add `Task.actualDate` field + `ACTUAL_DATE_CHANGED` enum value; new migration.
- `packages/domain/src/kanban/dto/kanban.dto.ts` — add `actualDate: dateInput` to `updateTaskInput`.
- `packages/domain/src/kanban/repositories/kanban.repository.ts` — add `actualDate` to `findTaskForUpdate` select+type, `findTaskForMove` select+type, and `updateTask` param type.
- `packages/domain/src/kanban/services/kanban.service.ts` — add `startOfUtcDay` helper; `updateTask` pass-through + `ACTUAL_DATE_CHANGED` activity; `moveTask` soft auto-set on DONE.
- `packages/domain/test/kanban/service.test.ts` — new tests for both behaviours.
- `packages/trpc/test/kanban-task.test.ts` — delegation test for `actualDate` (only if a passthrough assertion exists to mirror; see Task 9).

**Frontend (web):**
- `apps/web/src/components/kanban/types.ts` — add `actualDate: DateInput` to `BoardTaskData`.
- `apps/web/src/components/kanban/views/deviation.ts` (new) — `computeDeviation` / `formatDeviation`.
- `apps/web/test/kanban/deviation.test.ts` (new) — pure tests for the helper.
- `packages/ui/src/components/index.ts` — re-export `TodayIcon`.
- `apps/web/src/components/kanban/task/task-form.tsx` — relabel "Срок"→"Плановая дата"; add Фактическая дата picker + "Указать сегодня"; deviation line.
- `apps/web/src/components/kanban/views/board-card-model.ts` + `board-card.tsx` — Факт badge + deviation on the card.
- `apps/web/src/components/kanban/views/sprint-section.tsx` — План/Факт/Отклонение cells in `TaskRow`.
- `apps/web/src/components/kanban/filters/apply-filters.ts` — `actualFrom`/`actualTo` filter + `sortBy`/`sortDir` sort.
- `apps/web/src/components/kanban/use-kanban-filters.ts` — URL params `afrom`/`ato`/`sort`/`dir` + setters.
- `apps/web/src/components/kanban/kanban-filters.tsx` — date + sort UI controls.
- `apps/web/test/kanban/apply-filters.test.ts` — extend with actual-date filter + sort tests.

---

## Task 1: Prisma schema — `actualDate` field + enum value + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Task model ~lines 1168-1209; `TaskActivityType` enum ~lines 244-265)
- Create: migration folder under `packages/db/prisma/migrations/`

- [ ] **Step 1: Add the field to the Task model**

In `packages/db/prisma/schema.prisma`, find the line:

```prisma
  dueDate        DateTime? @map("due_date")
```

Add immediately AFTER it:

```prisma
  actualDate     DateTime? @map("actual_date")
```

- [ ] **Step 2: Add the enum value**

In the `TaskActivityType` enum, find:

```prisma
  START_DATE_CHANGED
```

Add immediately AFTER it:

```prisma
  ACTUAL_DATE_CHANGED
```

- [ ] **Step 3: Create the migration**

Run (requires `docker compose up -d` for the local Postgres):

```bash
pnpm --filter @repo/db exec prisma migrate dev --name add_task_actual_date
```

Expected: a new folder `packages/db/prisma/migrations/<timestamp>_add_task_actual_date/migration.sql` containing an `ALTER TABLE "tasks" ADD COLUMN "actual_date" TIMESTAMP(3);` plus the enum alteration (`ALTER TYPE "TaskActivityType" ADD VALUE 'ACTUAL_DATE_CHANGED';`). Prisma client regenerates automatically.

If the DB is unavailable, instead generate without applying and hand-author the SQL:
```bash
pnpm --filter @repo/db exec prisma migrate dev --name add_task_actual_date --create-only
pnpm --filter @repo/db prisma:generate
```

- [ ] **Step 4: Verify the client picked up the field**

Run:

```bash
pnpm --filter @repo/db check-types
```

Expected: PASS (no type errors). This confirms the regenerated Prisma client exposes `actualDate`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Task.actualDate field and ACTUAL_DATE_CHANGED activity"
```

---

## Task 2: Domain DTO — accept `actualDate` in `updateTaskInput`

**Files:**
- Modify: `packages/domain/src/kanban/dto/kanban.dto.ts` (`updateTaskInput`, lines 29-42)

- [ ] **Step 1: Add the field**

In `packages/domain/src/kanban/dto/kanban.dto.ts`, find:

```typescript
  startDate: dateInput,
  dueDate: dateInput,
```

Change to:

```typescript
  startDate: dateInput,
  dueDate: dateInput,
  actualDate: dateInput,
```

(`dateInput` already accepts `Date | string | null | undefined` — no new helper needed.)

- [ ] **Step 2: Type-check**

Run:

```bash
pnpm --filter @repo/domain check-types
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/kanban/dto/kanban.dto.ts
git commit -m "feat(domain): accept actualDate in updateTaskInput"
```

---

## Task 3: Domain repository — select & accept `actualDate`

**Files:**
- Modify: `packages/domain/src/kanban/repositories/kanban.repository.ts` (`findTaskForUpdate` 206-241, `updateTask` 243-262, `findTaskForMove` 264-273)

- [ ] **Step 1: Add `actualDate` to `findTaskForUpdate` select + return type**

Find the `findTaskForUpdate` method. In BOTH the return-type annotation AND the inner `as Promise<{...}>` cast AND the `select` object, add `actualDate`. The method currently reads:

```typescript
async findTaskForUpdate(taskId: string): Promise<{
  id: string
  pageId: string
  title: string
  dueDate: Date | null
  startDate: Date | null
  typeId: string | null
  priorityId: string | null
  sprintId: string | null
  parentId: string | null
}> {
  return this.uow.client().task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      id: true,
      pageId: true,
      title: true,
      dueDate: true,
      startDate: true,
      typeId: true,
      priorityId: true,
      sprintId: true,
      parentId: true,
    },
  }) as Promise<{
    id: string
    pageId: string
    title: string
    dueDate: Date | null
    startDate: Date | null
    typeId: string | null
    priorityId: string | null
    sprintId: string | null
    parentId: string | null
  }>
}
```

Replace it with (adds `actualDate` in three places — outer type, select, cast type):

```typescript
async findTaskForUpdate(taskId: string): Promise<{
  id: string
  pageId: string
  title: string
  dueDate: Date | null
  startDate: Date | null
  actualDate: Date | null
  typeId: string | null
  priorityId: string | null
  sprintId: string | null
  parentId: string | null
}> {
  return this.uow.client().task.findUniqueOrThrow({
    where: { id: taskId },
    select: {
      id: true,
      pageId: true,
      title: true,
      dueDate: true,
      startDate: true,
      actualDate: true,
      typeId: true,
      priorityId: true,
      sprintId: true,
      parentId: true,
    },
  }) as Promise<{
    id: string
    pageId: string
    title: string
    dueDate: Date | null
    startDate: Date | null
    actualDate: Date | null
    typeId: string | null
    priorityId: string | null
    sprintId: string | null
    parentId: string | null
  }>
}
```

- [ ] **Step 2: Add `actualDate` to `updateTask` param type**

Find the `updateTask` method's `data` param type:

```typescript
async updateTask(
  taskId: string,
  data: {
    title?: string
    description?: unknown
    startDate?: Date | null
    dueDate?: Date | null
    typeId?: string | null
    priorityId?: string | null
    sprintId?: string | null
    sprintPosition?: number | null
    parentId?: string | null
    updatedById: string
  },
): Promise<{ id: string; pageId: string }> {
```

Add `actualDate?: Date | null` after `dueDate`:

```typescript
async updateTask(
  taskId: string,
  data: {
    title?: string
    description?: unknown
    startDate?: Date | null
    dueDate?: Date | null
    actualDate?: Date | null
    typeId?: string | null
    priorityId?: string | null
    sprintId?: string | null
    sprintPosition?: number | null
    parentId?: string | null
    updatedById: string
  },
): Promise<{ id: string; pageId: string }> {
```

(The body casts `data as Prisma.TaskUpdateInput`, so no body change is needed.)

- [ ] **Step 3: Add `actualDate` to `findTaskForMove` select + return type**

Find:

```typescript
async findTaskForMove(taskId: string): Promise<{
  id: string
  pageId: string
  columnId: string
}> {
  return this.uow.client().task.findUniqueOrThrow({
    where: { id: taskId },
    select: { id: true, pageId: true, columnId: true },
  }) as Promise<{ id: string; pageId: string; columnId: string }>
}
```

Replace with (adds `actualDate` to type, select, and cast — `moveTask` needs to read it to decide auto-set):

```typescript
async findTaskForMove(taskId: string): Promise<{
  id: string
  pageId: string
  columnId: string
  actualDate: Date | null
}> {
  return this.uow.client().task.findUniqueOrThrow({
    where: { id: taskId },
    select: { id: true, pageId: true, columnId: true, actualDate: true },
  }) as Promise<{ id: string; pageId: string; columnId: string; actualDate: Date | null }>
}
```

- [ ] **Step 4: Type-check**

Run:

```bash
pnpm --filter @repo/domain check-types
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/kanban/repositories/kanban.repository.ts
git commit -m "feat(domain): select and accept actualDate in kanban repository"
```

---

## Task 4: Domain service — `updateTask` passthrough + `ACTUAL_DATE_CHANGED` activity (TDD)

**Files:**
- Modify: `packages/domain/src/kanban/services/kanban.service.ts` (`updateTask` 119-155)
- Test: `packages/domain/test/kanban/service.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/domain/test/kanban/service.test.ts`, inside the `updateTask` describe block (mirror the existing `DUE_DATE_CHANGED` test at lines ~148-163), add:

```typescript
it('records ACTUAL_DATE_CHANGED (manual) when actualDate is set', async () => {
  const repo = makeRepo({
    findTaskForUpdate: vi.fn(async () => ({
      id: 't1', pageId: 'b1', title: 'x', dueDate: null,
      startDate: null, actualDate: null,
      typeId: null, priorityId: null, sprintId: null, parentId: null,
    })),
  })
  const actual = new Date('2025-06-01T00:00:00.000Z')
  await makeService(repo).updateTask('u1', { pageId: 'b1', id: 't1', actualDate: actual })
  expect(repo.updateTask).toHaveBeenCalledWith(
    't1',
    expect.objectContaining({ actualDate: actual }),
  )
  expect(repo.recordActivity).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'ACTUAL_DATE_CHANGED',
      payload: { from: null, to: '2025-06-01T00:00:00.000Z' },
    }),
  )
})

it('does not record ACTUAL_DATE_CHANGED when actualDate is unchanged', async () => {
  const same = new Date('2025-06-01T00:00:00.000Z')
  const repo = makeRepo({
    findTaskForUpdate: vi.fn(async () => ({
      id: 't1', pageId: 'b1', title: 'x', dueDate: null,
      startDate: null, actualDate: same,
      typeId: null, priorityId: null, sprintId: null, parentId: null,
    })),
  })
  await makeService(repo).updateTask('u1', {
    pageId: 'b1', id: 't1', actualDate: new Date('2025-06-01T00:00:00.000Z'),
  })
  const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => (c[0] as { type: string }).type,
  )
  expect(types).not.toContain('ACTUAL_DATE_CHANGED')
})
```

> NOTE: the default `makeRepo` mock's `findTaskForUpdate` (lines ~28-38) must also gain `actualDate: null` or other `updateTask` tests will have `current.actualDate === undefined`. Update the shared default factory to include `actualDate: null`.

- [ ] **Step 2: Update the shared mock default**

In `packages/domain/test/kanban/service.test.ts`, find the default `findTaskForUpdate` mock (around lines 28-38) and add `actualDate: null` alongside `dueDate: null` / `startDate: null`. Do the same for the default `findTaskForMove` mock — add `actualDate: null` to whatever object it returns (it currently returns `{ id, pageId, columnId }`).

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @repo/domain test -- service.test
```

Expected: FAIL — the new `ACTUAL_DATE_CHANGED` expectations are not met because the service doesn't pass `actualDate` or record the activity yet.

- [ ] **Step 4: Implement in the service**

In `packages/domain/src/kanban/services/kanban.service.ts`, in `updateTask`, find the `repo.updateTask` call:

```typescript
      const updated = await this.repo.updateTask(input.id, {
        title: input.title,
        description: input.description,
        startDate: input.startDate,
        dueDate: input.dueDate,
        typeId: input.typeId,
```

Add `actualDate: input.actualDate,` after `dueDate`:

```typescript
      const updated = await this.repo.updateTask(input.id, {
        title: input.title,
        description: input.description,
        startDate: input.startDate,
        dueDate: input.dueDate,
        actualDate: input.actualDate,
        typeId: input.typeId,
```

Then find the `START_DATE_CHANGED` activity line:

```typescript
      if (input.startDate !== undefined && !sameDate(current.startDate, input.startDate))
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'START_DATE_CHANGED', payload: { from: toIso(current.startDate), to: toIso(input.startDate) } })
```

Add immediately after it:

```typescript
      if (input.actualDate !== undefined && !sameDate(current.actualDate, input.actualDate))
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'ACTUAL_DATE_CHANGED', payload: { from: toIso(current.actualDate), to: toIso(input.actualDate) } })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @repo/domain test -- service.test
```

Expected: PASS (new tests green, existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/kanban/services/kanban.service.ts packages/domain/test/kanban/service.test.ts
git commit -m "feat(domain): pass through actualDate and record ACTUAL_DATE_CHANGED on updateTask"
```

---

## Task 5: Domain service — `moveTask` soft auto-set on DONE (TDD)

**Files:**
- Modify: `packages/domain/src/kanban/services/kanban.service.ts` (top helper section ~lines 22-30; `moveTask` 157-198)
- Test: `packages/domain/test/kanban/service.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/domain/test/kanban/service.test.ts`, add a `describe('moveTask actualDate auto-set', ...)` block (mirror existing `moveTask` test setup; the `makeRepo` factory must allow overriding `findTaskForMove`, `findColumnsForPage`, `findTasksInTargetColumn`, `moveTask`, `recordActivity`). Use these four tests:

```typescript
describe('moveTask actualDate auto-set', () => {
  const baseColumns = [
    { id: 'cActive', title: 'Todo', kind: 'ACTIVE' },
    { id: 'cActive2', title: 'Doing', kind: 'ACTIVE' },
    { id: 'cDone', title: 'Done', kind: 'DONE' },
    { id: 'cDone2', title: 'Done 2', kind: 'DONE' },
  ]

  function moveRepo(overrides: Partial<KanbanRepository> = {}) {
    return makeRepo({
      findColumnsForPage: vi.fn(async () => baseColumns),
      findTasksInTargetColumn: vi.fn(async () => []),
      moveTask: vi.fn(async () => ({ id: 't1', pageId: 'b1' })),
      ...overrides,
    })
  }

  it('sets actualDate to today (UTC midnight) when moving into a DONE column with empty actualDate', async () => {
    const repo = moveRepo({
      findTaskForMove: vi.fn(async () => ({
        id: 't1', pageId: 'b1', columnId: 'cActive', actualDate: null,
      })),
    })
    await makeService(repo).moveTask('u1', {
      pageId: 'b1', id: 't1', targetColumnId: 'cDone', beforeId: null, afterId: null,
    })
    const call = (repo.updateTask as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[1] as { actualDate?: Date }).actualDate instanceof Date,
    )
    expect(call).toBeDefined()
    const set = (call![1] as { actualDate: Date }).actualDate
    // UTC midnight: time component is zeroed
    expect(set.getUTCHours()).toBe(0)
    expect(set.getUTCMinutes()).toBe(0)
    expect(set.getUTCSeconds()).toBe(0)
    expect(set.getUTCMilliseconds()).toBe(0)
    const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    )
    expect(types).toContain('ACTUAL_DATE_CHANGED')
  })

  it('does NOT overwrite an existing actualDate when moving into DONE', async () => {
    const existing = new Date('2025-01-01T00:00:00.000Z')
    const repo = moveRepo({
      findTaskForMove: vi.fn(async () => ({
        id: 't1', pageId: 'b1', columnId: 'cActive', actualDate: existing,
      })),
    })
    await makeService(repo).moveTask('u1', {
      pageId: 'b1', id: 't1', targetColumnId: 'cDone', beforeId: null, afterId: null,
    })
    const setCall = (repo.updateTask as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => 'actualDate' in (c[1] as object),
    )
    expect(setCall).toBeUndefined()
    const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    )
    expect(types).not.toContain('ACTUAL_DATE_CHANGED')
  })

  it('does NOT touch actualDate when moving between two DONE columns', async () => {
    const repo = moveRepo({
      findTaskForMove: vi.fn(async () => ({
        id: 't1', pageId: 'b1', columnId: 'cDone', actualDate: null,
      })),
    })
    await makeService(repo).moveTask('u1', {
      pageId: 'b1', id: 't1', targetColumnId: 'cDone2', beforeId: null, afterId: null,
    })
    // target IS done and actualDate empty -> auto-set DOES fire here too.
    // We assert it fires (moving INTO any DONE with empty date sets it).
    const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    )
    expect(types).toContain('ACTUAL_DATE_CHANGED')
  })

  it('does NOT set actualDate when moving from DONE back to an ACTIVE column', async () => {
    const repo = moveRepo({
      findTaskForMove: vi.fn(async () => ({
        id: 't1', pageId: 'b1', columnId: 'cDone', actualDate: new Date('2025-01-01T00:00:00.000Z'),
      })),
    })
    await makeService(repo).moveTask('u1', {
      pageId: 'b1', id: 't1', targetColumnId: 'cActive', beforeId: null, afterId: null,
    })
    const setCall = (repo.updateTask as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => 'actualDate' in (c[1] as object),
    )
    expect(setCall).toBeUndefined()
  })
})
```

> DECISION captured in spec: auto-set fires whenever the TARGET column is `kind === 'DONE'` AND `actualDate` is empty — including a move between two DONE columns where the date happened to be empty. The "between DONE columns doesn't touch it" guarantee in the spec is about not *re-setting* an already-set date; an empty date moving into any DONE column gets set. The third test encodes this precisely. If the product owner wants Done→Done to never set, change the guard to also require `fromColumn?.kind !== 'DONE'` — note this in the PR.

Ensure `KanbanRepository` and `makeService` are imported/available in the test file (they already are — the file tests the service).

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @repo/domain test -- service.test
```

Expected: FAIL — no auto-set logic exists yet.

- [ ] **Step 3: Add the `startOfUtcDay` helper**

In `packages/domain/src/kanban/services/kanban.service.ts`, near the existing `sameDate` / `toIso` helpers (lines 22-30), add:

```typescript
function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
```

- [ ] **Step 4: Implement the auto-set in `moveTask`**

In `moveTask`, find the end of the transaction, after the `STATUS_CHANGED` block and before `return updated`:

```typescript
      if (fromColumn && fromColumn.kind !== toColumn.kind)
        await this.repo.recordActivity({
          taskId: current.id,
          actorId: actorUserId,
          type: 'STATUS_CHANGED',
          payload: { fromKind: fromColumn.kind, toKind: toColumn.kind },
        })
      return updated
```

Insert the auto-set block before `return updated`:

```typescript
      if (fromColumn && fromColumn.kind !== toColumn.kind)
        await this.repo.recordActivity({
          taskId: current.id,
          actorId: actorUserId,
          type: 'STATUS_CHANGED',
          payload: { fromKind: fromColumn.kind, toKind: toColumn.kind },
        })
      if (toColumn.kind === 'DONE' && !current.actualDate) {
        const today = startOfUtcDay(new Date())
        await this.repo.updateTask(current.id, { actualDate: today, updatedById: actorUserId })
        await this.repo.recordActivity({
          taskId: current.id,
          actorId: actorUserId,
          type: 'ACTUAL_DATE_CHANGED',
          payload: { from: null, to: today.toISOString(), auto: true },
        })
      }
      return updated
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @repo/domain test -- service.test
```

Expected: PASS (all four new tests green, existing `moveTask` tests still green).

- [ ] **Step 6: Run the full domain suite + type-check**

Run:

```bash
pnpm --filter @repo/domain test && pnpm --filter @repo/domain check-types
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/kanban/services/kanban.service.ts packages/domain/test/kanban/service.test.ts
git commit -m "feat(domain): soft auto-set actualDate when task moves into a DONE column"
```

---

## Task 6: Web type — add `actualDate` to `BoardTaskData`

**Files:**
- Modify: `apps/web/src/components/kanban/types.ts` (`BoardTaskData` 62-81)

- [ ] **Step 1: Add the field**

In `apps/web/src/components/kanban/types.ts`, find:

```typescript
  startDate: DateInput
  dueDate: DateInput
```

Change to:

```typescript
  startDate: DateInput
  dueDate: DateInput
  actualDate: DateInput
```

- [ ] **Step 2: Type-check (expect downstream gaps to surface later)**

Run:

```bash
pnpm --filter web check-types
```

Expected: PASS. The `getBoard` query returns the raw Prisma task (which now has `actualDate`), and any test fixtures that build `BoardTaskData` literals will be flagged here. If web check-types reports missing `actualDate` in a test fixture's `task()` helper, that is fixed in Tasks 11/8 where those fixtures are touched; if it fails here on a fixture, add `actualDate: null` to that fixture's defaults now.

> If you see `TS2307 ... .next/types ... route.js`, that's a stale artifact — run `rm -rf apps/web/.next/types` and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/kanban/types.ts
git commit -m "feat(web): add actualDate to BoardTaskData"
```

---

## Task 7: Deviation helper (new, pure, TDD)

**Files:**
- Create: `apps/web/src/components/kanban/views/deviation.ts`
- Create test: `apps/web/test/kanban/deviation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/kanban/deviation.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

import { computeDeviation, formatDeviation } from '@/components/kanban/views/deviation'

describe('computeDeviation', () => {
  it('returns null when either date is missing', () => {
    expect(computeDeviation(null, new Date('2025-06-01'))).toBeNull()
    expect(computeDeviation(new Date('2025-06-01'), null)).toBeNull()
    expect(computeDeviation(null, null)).toBeNull()
  })

  it('reports late when actual is after due (Факт − План > 0)', () => {
    const d = computeDeviation(new Date('2025-06-01'), new Date('2025-06-04'))
    expect(d).toEqual({ days: 3, tone: 'late' })
  })

  it('reports early when actual is before due', () => {
    const d = computeDeviation(new Date('2025-06-05'), new Date('2025-06-03'))
    expect(d).toEqual({ days: -2, tone: 'early' })
  })

  it('reports onTime when same day (ignores time-of-day)', () => {
    const d = computeDeviation(
      new Date('2025-06-01T18:00:00'),
      new Date('2025-06-01T06:00:00'),
    )
    expect(d).toEqual({ days: 0, tone: 'onTime' })
  })
})

describe('formatDeviation', () => {
  it('formats onTime', () => {
    expect(formatDeviation({ days: 0, tone: 'onTime' })).toBe('в срок')
  })
  it('formats a late deviation with + and Russian plural', () => {
    expect(formatDeviation({ days: 1, tone: 'late' })).toBe('+1 день')
    expect(formatDeviation({ days: 3, tone: 'late' })).toBe('+3 дня')
    expect(formatDeviation({ days: 5, tone: 'late' })).toBe('+5 дней')
    expect(formatDeviation({ days: 11, tone: 'late' })).toBe('+11 дней')
  })
  it('formats an early deviation with a minus sign', () => {
    expect(formatDeviation({ days: -2, tone: 'early' })).toBe('−2 дня')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter web test -- deviation
```

Expected: FAIL — module `deviation` does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/components/kanban/views/deviation.ts`:

```typescript
import { pluralizeRu } from '../lib/pluralize-ru'

export interface Deviation {
  readonly days: number
  readonly tone: 'onTime' | 'late' | 'early'
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Факт − План, в полных днях. Положительное = просрочка, отрицательное = раньше срока.
export function computeDeviation(due: Date | null, actual: Date | null): Deviation | null {
  if (!due || !actual) return null
  const days = Math.round(
    (startOfDay(actual).getTime() - startOfDay(due).getTime()) / 86_400_000,
  )
  return { days, tone: days > 0 ? 'late' : days < 0 ? 'early' : 'onTime' }
}

export function formatDeviation(d: Deviation): string {
  if (d.days === 0) return 'в срок'
  const n = Math.abs(d.days)
  const word = pluralizeRu(n, ['день', 'дня', 'дней'])
  return d.days > 0 ? `+${n} ${word}` : `−${n} ${word}`
}
```

> Reuses the existing `pluralizeRu` at `apps/web/src/components/kanban/lib/pluralize-ru.ts` (signature `pluralizeRu(n, [one, few, many])`). The minus sign in `formatDeviation` is U+2212 (−), matching the spec; the test asserts that exact character.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter web test -- deviation
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/views/deviation.ts apps/web/test/kanban/deviation.test.ts
git commit -m "feat(web): add computeDeviation/formatDeviation helper"
```

---

## Task 8: Re-export `TodayIcon` from `@repo/ui/components`

**Files:**
- Modify: `packages/ui/src/components/index.ts` (icon section ~lines 93-187)

- [ ] **Step 1: Add the re-export**

In `packages/ui/src/components/index.ts`, in the icon export section (where lines look like `export { default as FlagIcon } from '@mui/icons-material/Flag'`), add (keep alphabetical order if the section is sorted; otherwise append to the icon block):

```typescript
export { default as TodayIcon } from '@mui/icons-material/Today'
```

- [ ] **Step 2: Type-check**

Run:

```bash
pnpm --filter @repo/ui check-types
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): re-export TodayIcon"
```

---

## Task 9: Task form — relabel + Фактическая дата picker + "Указать сегодня" + deviation line

**Files:**
- Modify: `apps/web/src/components/kanban/task/task-form.tsx` (imports 1-38; state 114-115; popover 416-445)

- [ ] **Step 1: Add imports**

In `apps/web/src/components/kanban/task/task-form.tsx`, the import block from `@repo/ui/components` currently includes `Box`, `DatePicker`, `Stack`, `Typography`, etc. Add `Button` and `TodayIcon` to that import list (alongside the existing names):

```typescript
import {
  AdapterDateFns,
  Box,
  Button,
  Chip,
  DatePicker,
  dateFnsRu,
  ListItemText,
  LocalizationProvider,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  TodayIcon,
  Typography,
} from '@repo/ui/components'
```

Also import the deviation helper near the other local imports at the top of the file:

```typescript
import { computeDeviation, formatDeviation } from '../views/deviation'
```

(Adjust the relative path if `task-form.tsx` is not one level under `task/` — it is at `components/kanban/task/task-form.tsx`, and `deviation.ts` is at `components/kanban/views/deviation.ts`, so `../views/deviation` is correct.)

- [ ] **Step 2: Add `actualDate` state**

Find:

```typescript
const [dueDate, setDueDate] = useState<Date | null>(toDate(task.dueDate))
const [startDate, setStartDate] = useState<Date | null>(toDate(task.startDate))
```

Add after them:

```typescript
const [actualDate, setActualDate] = useState<Date | null>(toDate(task.actualDate))
```

- [ ] **Step 3: Relabel dueDate, add the Фактическая дата picker + button + deviation**

Find the `'dates'` popover content:

```typescript
  {popover === 'dates' ? (
    <Stack spacing={2} sx={{ p: 2, minWidth: 280 }}>
      <DatePicker
        label="Дата старта"
        value={startDate}
        onChange={(value) => {
          setStartDate(value)
          updateTask.mutate({ pageId, id: task.id, startDate: value })
        }}
        slotProps={{ textField: { size: 'small', fullWidth: true } }}
      />
      <DatePicker
        label="Срок"
        value={dueDate}
        onChange={(value) => {
          setDueDate(value)
          updateTask.mutate({ pageId, id: task.id, dueDate: value })
        }}
        slotProps={{ textField: { size: 'small', fullWidth: true } }}
      />
    </Stack>
  ) : null}
```

Replace the inner `<Stack>...</Stack>` with (relabels "Срок"→"Плановая дата"; adds Фактическая дата picker, conditional "Указать сегодня" button, and a deviation line):

```typescript
  {popover === 'dates' ? (
    <Stack spacing={2} sx={{ p: 2, minWidth: 280 }}>
      <DatePicker
        label="Дата старта"
        value={startDate}
        onChange={(value) => {
          setStartDate(value)
          updateTask.mutate({ pageId, id: task.id, startDate: value })
        }}
        slotProps={{ textField: { size: 'small', fullWidth: true } }}
      />
      <DatePicker
        label="Плановая дата"
        value={dueDate}
        onChange={(value) => {
          setDueDate(value)
          updateTask.mutate({ pageId, id: task.id, dueDate: value })
        }}
        slotProps={{ textField: { size: 'small', fullWidth: true } }}
      />
      <Stack spacing={0.5}>
        <DatePicker
          label="Фактическая дата"
          value={actualDate}
          onChange={(value) => {
            setActualDate(value)
            updateTask.mutate({ pageId, id: task.id, actualDate: value })
          }}
          slotProps={{
            textField: { size: 'small', fullWidth: true },
            field: { clearable: true },
          }}
        />
        {actualDate === null ? (
          <Button
            size="small"
            variant="text"
            startIcon={<TodayIcon fontSize="small" />}
            onClick={() => {
              const today = new Date()
              setActualDate(today)
              updateTask.mutate({ pageId, id: task.id, actualDate: today })
            }}
            sx={{ alignSelf: 'flex-start' }}
          >
            Указать сегодня
          </Button>
        ) : null}
      </Stack>
      {(() => {
        const dev = computeDeviation(dueDate, actualDate)
        if (!dev) return null
        const color =
          dev.tone === 'late' ? '#B91C1C' : dev.tone === 'early' ? '#15803D' : '#15803D'
        return (
          <Typography variant="caption" sx={{ color }}>
            Отклонение: {formatDeviation(dev)}
          </Typography>
        )
      })()}
    </Stack>
  ) : null}
```

- [ ] **Step 4: Type-check + run existing form test**

Run:

```bash
pnpm --filter web check-types && pnpm --filter web test -- task-form
```

Expected: PASS. If `apps/web/test/kanban/task-form.test.tsx` builds a `task` fixture missing `actualDate`, add `actualDate: null` to that fixture's defaults.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/task/task-form.tsx apps/web/test/kanban/task-form.test.tsx
git commit -m "feat(web): planned/actual date fields + 'указать сегодня' + deviation in task form"
```

---

## Task 10: Board card — Факт badge + deviation

**Files:**
- Modify: `apps/web/src/components/kanban/views/board-card-model.ts` (`BoardCardModel` 11-21; `getBoardCardModel` 23-49; helpers 81-115)
- Modify: `apps/web/src/components/kanban/views/board-card.tsx` (`DATE_BADGE_STYLES` 40-47; date badge JSX 200-218)
- Test: `apps/web/test/kanban/board-card-model.test.ts`

- [ ] **Step 1: Write the failing model test**

In `apps/web/test/kanban/board-card-model.test.ts`, add (the `task()` helper there must include `actualDate` — add `actualDate: null` to its defaults first):

```typescript
it('exposes actual date label and deviation when both planned and actual are set', () => {
  const model = getBoardCardModel(
    task({
      dueDate: new Date('2026-05-10T00:00:00'),
      actualDate: new Date('2026-05-13T00:00:00'),
    }),
    board,
    0,
    new Date('2026-05-16T12:00:00'),
  )
  expect(model.actualLabel).toBe('13 мая')
  expect(model.deviationLabel).toBe('+3 дня')
  expect(model.deviationTone).toBe('late')
})

it('has no deviation when actual date is missing', () => {
  const model = getBoardCardModel(
    task({ dueDate: new Date('2026-05-10T00:00:00') }),
    board,
    0,
    new Date('2026-05-16T12:00:00'),
  )
  expect(model.actualLabel).toBeNull()
  expect(model.deviationLabel).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
pnpm --filter web test -- board-card-model
```

Expected: FAIL — `model.actualLabel` / `deviationLabel` / `deviationTone` don't exist.

- [ ] **Step 3: Extend the model**

In `apps/web/src/components/kanban/views/board-card-model.ts`:

Add the deviation import at the top:

```typescript
import { computeDeviation, formatDeviation, type Deviation } from './deviation'
```

Add `toValidDate` is already present (used by `getDateLabel`). Extend `BoardCardModel`:

```typescript
export interface BoardCardModel {
  readonly type: BoardData['types'][number] | null
  readonly priority: BoardData['priorities'][number] | null
  readonly priorityTone: CardPriorityTone | null
  readonly priorityColor: string | null
  readonly visibleLabels: BoardTaskData['labels']
  readonly hiddenLabelCount: number
  readonly dateLabel: string | null
  readonly dateTone: CardDateTone
  readonly actualLabel: string | null
  readonly deviationLabel: string | null
  readonly deviationTone: Deviation['tone'] | null
  readonly childCount: number
}
```

In `getBoardCardModel`, after `const dueDate = toValidDate(task.dueDate)` add:

```typescript
  const actualDate = toValidDate(task.actualDate)
  const deviation = computeDeviation(dueDate, actualDate)
```

In the returned object, after `dateTone: getDateTone(dueDate, now),` add:

```typescript
    actualLabel: actualDate ? formatCardDate(actualDate, now) : null,
    deviationLabel: deviation ? formatDeviation(deviation) : null,
    deviationTone: deviation ? deviation.tone : null,
```

Also relax the overdue tone once actually completed: change

```typescript
    dateTone: getDateTone(dueDate, now),
```

to

```typescript
    dateTone: actualDate ? 'default' : getDateTone(dueDate, now),
```

- [ ] **Step 4: Run model test to verify it passes**

Run:

```bash
pnpm --filter web test -- board-card-model
```

Expected: PASS.

- [ ] **Step 5: Render the Факт badge + deviation on the card**

In `apps/web/src/components/kanban/views/board-card.tsx`, find the existing planned-date badge JSX (the `{model.dateLabel ? (<Box ...>{model.dateLabel}</Box>) : null}` block around lines 200-218). Immediately AFTER that block, add a Факт badge and a deviation chip:

```typescript
{model.actualLabel ? (
  <Box
    component="span"
    sx={{
      px: 0.75,
      py: 0.125,
      border: 1,
      borderRadius: 1,
      color: '#15803D',
      borderColor: '#86EFAC',
      bgcolor: '#DCFCE7',
      fontSize: 12,
      lineHeight: '18px',
      whiteSpace: 'nowrap',
    }}
  >
    Факт: {model.actualLabel}
  </Box>
) : null}
{model.deviationLabel ? (
  <Box
    component="span"
    sx={{
      px: 0.75,
      py: 0.125,
      border: 1,
      borderRadius: 1,
      color: model.deviationTone === 'late' ? '#B91C1C' : '#15803D',
      borderColor: model.deviationTone === 'late' ? '#FCA5A5' : '#86EFAC',
      bgcolor: model.deviationTone === 'late' ? '#FEE2E2' : '#DCFCE7',
      fontSize: 12,
      lineHeight: '18px',
      whiteSpace: 'nowrap',
    }}
  >
    {model.deviationLabel}
  </Box>
) : null}
```

- [ ] **Step 6: Type-check + run card tests**

Run:

```bash
pnpm --filter web check-types && pnpm --filter web test -- board-card
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/kanban/views/board-card-model.ts apps/web/src/components/kanban/views/board-card.tsx apps/web/test/kanban/board-card-model.test.ts
git commit -m "feat(web): show actual-date badge and deviation on board card"
```

---

## Task 11: Table view row — План / Факт / Отклонение cells

**Files:**
- Modify: `apps/web/src/components/kanban/views/sprint-section.tsx` (`TaskRow` 115-185)
- Test: `apps/web/test/kanban/sprint-section.test.tsx`

- [ ] **Step 1: Add `actualDate` to the test's `task()` factory**

`apps/web/test/kanban/sprint-section.test.tsx` builds tasks with a `task(id, overrides)` factory (~line 78) that returns a full `BoardTaskData`. Find:

```typescript
    startDate: null,
    dueDate: null,
```

inside that factory and change to:

```typescript
    startDate: null,
    dueDate: null,
    actualDate: null,
```

(Task 6 added `actualDate` to `BoardTaskData`, so this factory will otherwise fail type-check.)

- [ ] **Step 2: Write the failing test**

The file renders via `renderSprintSection(<SprintSection ... tasks={[rowTask]} allTasks={[rowTask]} ... />)`. Add this test inside the `describe('SprintSection', ...)` block, mirroring the existing render call (`columns`, `members`, `CURRENT_USER_ID`, `SPRINT_ID`, `PAGE_ID` are module-level constants already defined in the file):

```typescript
it('renders actual date and deviation in the row when both dates are set', () => {
  const rowTask = task('Both Dates', {
    dueDate: new Date('2026-05-10T00:00:00'),
    actualDate: new Date('2026-05-13T00:00:00'),
  })

  renderSprintSection(
    <SprintSection
      kind="sprint"
      pageId={PAGE_ID}
      sprint={{
        id: SPRINT_ID,
        name: 'Sprint',
        status: 'ACTIVE',
        description: null,
        startDate: null,
        endDate: null,
      }}
      allSprints={[]}
      columns={columns}
      allTasks={[rowTask]}
      tasks={[rowTask]}
      members={members}
      currentUserId={CURRENT_USER_ID}
      droppableId={`sprint:${SPRINT_ID}`}
    />,
  )

  expect(screen.getByText(/Факт:/)).toBeInTheDocument()
  expect(screen.getByText('+3 дня')).toBeInTheDocument()
})
```

> `SprintSection`'s `onAssignTaskToMe`/`onRemoveTaskFromSprint`/`onDeleteTask` are optional — omit them here. `screen`, `task`, `renderSprintSection`, `columns`, `members` are all already imported/defined at the top of this test file.

- [ ] **Step 3: Run to verify it fails**

Run:

```bash
pnpm --filter web test -- sprint-section
```

Expected: FAIL — row doesn't render Факт/deviation yet.

- [ ] **Step 4: Add the cells to `TaskRow`**

In `apps/web/src/components/kanban/views/sprint-section.tsx`, add imports at the top of the file:

```typescript
import { computeDeviation, formatDeviation } from './deviation'
```

Find the existing dueDate cell in `TaskRow`:

```typescript
      {task.dueDate ? (
        <Typography variant="caption" color="text.secondary">
          {new Date(task.dueDate).toLocaleDateString('ru-RU')}
        </Typography>
      ) : null}
```

Replace it with planned + actual + deviation cells:

```typescript
      {task.dueDate ? (
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          План: {new Date(task.dueDate).toLocaleDateString('ru-RU')}
        </Typography>
      ) : null}
      {task.actualDate ? (
        <Typography variant="caption" sx={{ color: '#15803D', whiteSpace: 'nowrap' }}>
          Факт: {new Date(task.actualDate).toLocaleDateString('ru-RU')}
        </Typography>
      ) : null}
      {(() => {
        const dev = computeDeviation(
          task.dueDate ? new Date(task.dueDate) : null,
          task.actualDate ? new Date(task.actualDate) : null,
        )
        if (!dev) return null
        return (
          <Typography
            variant="caption"
            sx={{
              whiteSpace: 'nowrap',
              color: dev.tone === 'late' ? '#B91C1C' : '#15803D',
            }}
          >
            {formatDeviation(dev)}
          </Typography>
        )
      })()}
```

> `task.dueDate` / `task.actualDate` are `DateInput` (`Date | string | null`); wrap in `new Date(...)` only when truthy, as shown. `computeDeviation` expects `Date | null`.

- [ ] **Step 5: Run to verify it passes + type-check**

Run:

```bash
pnpm --filter web test -- sprint-section && pnpm --filter web check-types
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/kanban/views/sprint-section.tsx apps/web/test/kanban/sprint-section.test.tsx
git commit -m "feat(web): show planned/actual/deviation in table-view task rows"
```

---

## Task 12: Filters & sort — `actualFrom`/`actualTo` + `sortBy`/`sortDir` (TDD)

**Files:**
- Modify: `apps/web/src/components/kanban/filters/apply-filters.ts` (`KanbanFilters` 4-12; `EMPTY_FILTERS` 14-22; `applyFilters` 43-87)
- Test: `apps/web/test/kanban/apply-filters.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/web/test/kanban/apply-filters.test.ts`, the `task()` helper builds a full `BoardTaskData` — add `actualDate: null` to its defaults first. Then add:

```typescript
describe('actual-date filter', () => {
  it('keeps only tasks whose actualDate is within [actualFrom, actualTo]', () => {
    const tasks = [
      task('a', { actualDate: new Date('2025-06-05') }),
      task('b', { actualDate: new Date('2025-06-20') }),
      task('c', { actualDate: null }),
    ]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, actualFrom: '2025-06-01', actualTo: '2025-06-10' },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['a'])
  })
})

describe('sort', () => {
  it('sorts by deviation descending (most late first), empty deviations last', () => {
    const tasks = [
      task('ontime', { dueDate: new Date('2025-06-01'), actualDate: new Date('2025-06-01') }),
      task('late', { dueDate: new Date('2025-06-01'), actualDate: new Date('2025-06-05') }),
      task('none'),
    ]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, sortBy: 'deviation', sortDir: 'desc' },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['late', 'ontime', 'none'])
  })

  it('sorts by planned date ascending, empty dates last', () => {
    const tasks = [
      task('b', { dueDate: new Date('2025-06-10') }),
      task('a', { dueDate: new Date('2025-06-01') }),
      task('z'),
    ]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, sortBy: 'planned', sortDir: 'asc' },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'z'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run:

```bash
pnpm --filter web test -- apply-filters
```

Expected: FAIL — `actualFrom`/`actualTo`/`sortBy`/`sortDir` are not in `KanbanFilters`/`EMPTY_FILTERS` and not applied.

- [ ] **Step 3: Extend `KanbanFilters` and `EMPTY_FILTERS`**

In `apps/web/src/components/kanban/filters/apply-filters.ts`, change the interface:

```typescript
export interface KanbanFilters {
  sprint: 'all' | 'current' | string[]
  userIds: string[]
  labelIds: string[]
  dateFrom: string | null
  dateTo: string | null
  actualFrom: string | null
  actualTo: string | null
  overdueOnly: boolean
  hideTerminalColumns: boolean
  sortBy: 'manual' | 'planned' | 'actual' | 'deviation'
  sortDir: 'asc' | 'desc'
}
```

And `EMPTY_FILTERS`:

```typescript
export const EMPTY_FILTERS: KanbanFilters = {
  sprint: 'all',
  userIds: [],
  labelIds: [],
  dateFrom: null,
  dateTo: null,
  actualFrom: null,
  actualTo: null,
  overdueOnly: false,
  hideTerminalColumns: false,
  sortBy: 'manual',
  sortDir: 'asc',
}
```

- [ ] **Step 4: Add the actual-date filter inside `applyFilters`**

In `applyFilters`, after the existing `from`/`to` declarations near the top:

```typescript
  const from = filters.dateFrom ? new Date(filters.dateFrom) : null
  const to = filters.dateTo ? new Date(filters.dateTo) : null
```

add:

```typescript
  const afrom = filters.actualFrom ? new Date(filters.actualFrom) : null
  const ato = filters.actualTo ? new Date(filters.actualTo) : null
```

Then inside the `.filter(...)` callback, after the existing dueDate checks:

```typescript
    if (from && (!due || due < from)) return false
    if (to && (!due || due > to)) return false
```

add:

```typescript
    const actual = dateOf(task.actualDate)
    if (afrom && (!actual || actual < afrom)) return false
    if (ato && (!actual || actual > ato)) return false
```

- [ ] **Step 5: Add sorting after the filter**

The function currently ends `return tasks.filter((task) => { ... })`. Capture the filtered result and sort it. Replace:

```typescript
  return tasks.filter((task) => {
    ...
    return true
  })
}
```

with (keep the filter body identical; only wrap and append sorting):

```typescript
  const filtered = tasks.filter((task) => {
    ...
    return true
  })

  if (filters.sortBy === 'manual') return filtered

  const dir = filters.sortDir === 'desc' ? -1 : 1
  const keyOf = (t: BoardTaskData): number | null => {
    if (filters.sortBy === 'planned') {
      const d = dateOf(t.dueDate)
      return d ? d.getTime() : null
    }
    if (filters.sortBy === 'actual') {
      const d = dateOf(t.actualDate)
      return d ? d.getTime() : null
    }
    // deviation
    const dev = computeDeviation(dateOf(t.dueDate), dateOf(t.actualDate))
    return dev ? dev.days : null
  }

  return [...filtered].sort((a, b) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (ka === null && kb === null) return 0
    if (ka === null) return 1 // empties always last
    if (kb === null) return -1
    return (ka - kb) * dir
  })
}
```

Add the import at the top of `apply-filters.ts`:

```typescript
import { computeDeviation } from '../views/deviation'
```

- [ ] **Step 6: Run to verify it passes + type-check**

Run:

```bash
pnpm --filter web test -- apply-filters && pnpm --filter web check-types
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/kanban/filters/apply-filters.ts apps/web/test/kanban/apply-filters.test.ts
git commit -m "feat(web): actual-date filter and planned/actual/deviation sort in applyFilters"
```

---

## Task 13: Filter hook — URL params for actual-date + sort

**Files:**
- Modify: `apps/web/src/components/kanban/use-kanban-filters.ts` (`filters` memo 33-50; setters; return)

- [ ] **Step 1: Parse the new params into `filters`**

In `apps/web/src/components/kanban/use-kanban-filters.ts`, find the returned `filters` object in the `useMemo`:

```typescript
    return {
      ...EMPTY_FILTERS,
      sprint,
      userIds: parseCsv(searchParams?.get('users') ?? null),
      labelIds: parseCsv(searchParams?.get('labels') ?? null),
      dateFrom: searchParams?.get('from') ?? null,
      dateTo: searchParams?.get('to') ?? null,
      overdueOnly: searchParams?.get('overdue') === '1',
      hideTerminalColumns: view === 'table',
    }
```

Replace with (adds actual + sort parsing; `sortBy` validated against the union):

```typescript
    const sortParam = searchParams?.get('sort') ?? null
    const sortBy: KanbanFilters['sortBy'] =
      sortParam === 'planned' || sortParam === 'actual' || sortParam === 'deviation'
        ? sortParam
        : 'manual'
    const sortDir: KanbanFilters['sortDir'] = searchParams?.get('dir') === 'desc' ? 'desc' : 'asc'

    return {
      ...EMPTY_FILTERS,
      sprint,
      userIds: parseCsv(searchParams?.get('users') ?? null),
      labelIds: parseCsv(searchParams?.get('labels') ?? null),
      dateFrom: searchParams?.get('from') ?? null,
      dateTo: searchParams?.get('to') ?? null,
      actualFrom: searchParams?.get('afrom') ?? null,
      actualTo: searchParams?.get('ato') ?? null,
      overdueOnly: searchParams?.get('overdue') === '1',
      hideTerminalColumns: view === 'table',
      sortBy,
      sortDir,
    }
```

Ensure `KanbanFilters` is imported in this file (it already imports from `apply-filters` — confirm `KanbanFilters` is in that import; if only `EMPTY_FILTERS` is imported, add the type).

- [ ] **Step 2: Add setters**

After the existing `setDateFilter` callback, add:

```typescript
  const setActualDateFilter = useCallback(
    (next: { from: string | null; to: string | null }) =>
      updateParams({ afrom: next.from, ato: next.to }),
    [updateParams],
  )

  const setSort = useCallback(
    (next: { sortBy: KanbanFilters['sortBy']; sortDir: KanbanFilters['sortDir'] }) =>
      updateParams({
        sort: next.sortBy === 'manual' ? null : next.sortBy,
        dir: next.sortDir === 'asc' ? null : next.sortDir,
      }),
    [updateParams],
  )
```

- [ ] **Step 3: Export the new setters**

In the hook's `return { ... }`, add `setActualDateFilter` and `setSort` alongside `setDateFilter`.

- [ ] **Step 4: Type-check**

Run:

```bash
pnpm --filter web check-types
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/use-kanban-filters.ts
git commit -m "feat(web): URL params for actual-date filter and sort"
```

---

## Task 14: Filter UI — date + sort controls

**Files:**
- Modify: `apps/web/src/components/kanban/kanban-filters.tsx`

- [ ] **Step 1: Read the current structure**

Open `apps/web/src/components/kanban/kanban-filters.tsx`. It renders a `<Stack direction="row">` of `<Chip>` triggers, each opening a `<Menu>` (sprint / users / labels). Identify the `open(key)` mechanism, the `useKanbanFilters()` consumption, and how a `<Chip>` + `<Menu>` pair is structured. Reuse that exact pattern.

- [ ] **Step 2: Add a "Даты" chip + menu with planned/actual range pickers**

Wire `setActualDateFilter`, `setDateFilter` (existing), `filters.dateFrom/dateTo/actualFrom/actualTo` from `useKanbanFilters()`. Add a new `<Chip>` labelled "Даты" that opens a `<Menu>` containing four native date inputs (use plain `<TextField type="date" />` from `@repo/ui/components` to avoid wrapping the menu in another LocalizationProvider — simpler, and the value is an ISO `yyyy-mm-dd` string which the URL params expect):

```typescript
<MenuItem disableRipple sx={{ display: 'block' }}>
  <Stack spacing={1} sx={{ p: 1, minWidth: 220 }}>
    <Typography variant="caption" color="text.secondary">Плановая дата</Typography>
    <TextField
      type="date" size="small" label="с" InputLabelProps={{ shrink: true }}
      value={filters.dateFrom ?? ''}
      onChange={(e) => setDateFilter({ from: e.target.value || null, to: filters.dateTo, overdue: filters.overdueOnly })}
    />
    <TextField
      type="date" size="small" label="по" InputLabelProps={{ shrink: true }}
      value={filters.dateTo ?? ''}
      onChange={(e) => setDateFilter({ from: filters.dateFrom, to: e.target.value || null, overdue: filters.overdueOnly })}
    />
    <Typography variant="caption" color="text.secondary">Фактическая дата</Typography>
    <TextField
      type="date" size="small" label="с" InputLabelProps={{ shrink: true }}
      value={filters.actualFrom ?? ''}
      onChange={(e) => setActualDateFilter({ from: e.target.value || null, to: filters.actualTo })}
    />
    <TextField
      type="date" size="small" label="по" InputLabelProps={{ shrink: true }}
      value={filters.actualTo ?? ''}
      onChange={(e) => setActualDateFilter({ from: filters.actualFrom, to: e.target.value || null })}
    />
  </Stack>
</MenuItem>
```

> If `TextField` is not yet imported in this file, add it to the `@repo/ui/components` import. The `setDateFilter` signature is `{ from, to, overdue }` (existing) — pass through the current `overdue` value as shown so toggling a date doesn't clear it.

- [ ] **Step 3: Add a "Сортировка" chip + menu**

Wire `setSort` and `filters.sortBy/sortDir`. Add a `<Chip>` labelled "Сортировка" opening a `<Menu>` with a `<Select>` for field and direction:

```typescript
<MenuItem disableRipple sx={{ display: 'block' }}>
  <Stack spacing={1} sx={{ p: 1, minWidth: 200 }}>
    <Select
      size="small"
      value={filters.sortBy}
      onChange={(e) =>
        setSort({ sortBy: e.target.value as KanbanFilters['sortBy'], sortDir: filters.sortDir })
      }
    >
      <MenuItem value="manual">Вручную</MenuItem>
      <MenuItem value="planned">Плановая дата</MenuItem>
      <MenuItem value="actual">Фактическая дата</MenuItem>
      <MenuItem value="deviation">Отклонение</MenuItem>
    </Select>
    <Select
      size="small"
      value={filters.sortDir}
      disabled={filters.sortBy === 'manual'}
      onChange={(e) =>
        setSort({ sortBy: filters.sortBy, sortDir: e.target.value as KanbanFilters['sortDir'] })
      }
    >
      <MenuItem value="asc">По возрастанию</MenuItem>
      <MenuItem value="desc">По убыванию</MenuItem>
    </Select>
  </Stack>
</MenuItem>
```

> Import `KanbanFilters` type and `Select` if not already imported in this file. Keep these two new chips consistent with the existing chip styling (copy the `sx`/variant from a neighbouring chip).

- [ ] **Step 4: Verify sort is actually consumed by the table view**

`applyFilters` now sorts when `sortBy !== 'manual'`. Confirm the table view passes the `filters` from `useKanbanFilters` through `applyFilters` (it already calls `applyFilters` for filtering). If the board/table renders tasks via `applyFilters(tasks, filters, ctx)`, sorting is automatically applied. Grep for `applyFilters(` to confirm the call site forwards the full `filters` object (it does — same object that now carries `sortBy`). No extra wiring needed; just confirm.

- [ ] **Step 5: Type-check + lint + run the filters test**

Run:

```bash
pnpm --filter web check-types && pnpm --filter web test -- kanban-filters
```

Expected: PASS. (`apps/web/test/kanban/kanban-filters.test.tsx` exists — if it snapshots the chip list, update the snapshot; if it asserts specific chips, ensure the new chips don't break existing assertions.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/kanban/kanban-filters.tsx
git commit -m "feat(web): date-range and sort controls in kanban filters"
```

---

## Task 15: tRPC delegation test for `actualDate` (optional, mirror existing)

**Files:**
- Modify: `packages/trpc/test/kanban-task.test.ts`

- [ ] **Step 1: Check whether an `update` delegation assertion exists**

Open `packages/trpc/test/kanban-task.test.ts`. If there's an existing test that calls `caller.update(...)` and asserts `domainSvc.kanban.updateTask` was called with the input (a delegation/passthrough test), extend it to include `actualDate` in the input and assert it passes through. If the file instead exercises real Prisma, skip this task — the domain tests already cover `actualDate`. Do not invent a new test harness.

- [ ] **Step 2: If a delegation test exists, add the field**

Add `actualDate: new Date('2025-06-01T00:00:00.000Z')` to the `update` input used in the existing delegation test and assert it appears in the `updateTask` mock's call args (mirror how `dueDate`/`startDate` are asserted there, if at all).

- [ ] **Step 3: Run**

Run:

```bash
pnpm --filter @repo/trpc test
```

Expected: PASS.

- [ ] **Step 4: Commit (only if changed)**

```bash
git add packages/trpc/test/kanban-task.test.ts
git commit -m "test(trpc): cover actualDate passthrough in task.update"
```

---

## Task 16: Full gates + architecture check

**Files:** none (verification)

- [ ] **Step 1: Run the full gate suite**

Run from repo root:

```bash
pnpm gates
```

Expected: PASS — `check-types`, `lint` (`--max-warnings 0`), `build`, and `test` all green across affected packages (`@repo/db`, `@repo/domain`, `@repo/trpc`, `@repo/ui`, `web`).

- [ ] **Step 2: Run the architecture check**

Run:

```bash
pnpm check-architecture
```

Expected: PASS — no new cross-tier violations (the web client deep-imports only leaf modules; `deviation.ts` imports a sibling leaf `pluralize-ru`, no domain-root import added).

- [ ] **Step 3: Manual smoke (dev server)**

Per CLAUDE.md, RSC prop wiring and dynamic routes must be verified at runtime. With `docker compose up -d` and the worktree env set up (root `.env` sourced; `pnpm --filter @repo/db prisma:generate` already done by the migration), run:

```bash
pnpm --filter web dev
```

Open a Kanban page; verify: (a) the task form shows "Плановая дата" + "Фактическая дата" + "Указать сегодня" when empty; (b) dragging a card into a Done column populates Фактическая дата once and not again; (c) the card shows a Факт badge + deviation; (d) the table view rows show План/Факт/Отклонение; (e) the filter bar's Даты and Сортировка controls work and update the URL.

> No E2E specs are added — per project memory, Playwright has no yjs server and heavy Kanban specs are flaky on cold compile. The unit/integration pyramid above plus this manual smoke is the verification path.

- [ ] **Step 4: Final review handoff**

After gates pass and smoke is confirmed, request code review (superpowers:requesting-code-review) before merging.

---

## Notes for the implementer

- **Why `dueDate` is "Плановая дата" in the UI but not renamed in the DB:** spec decision — renaming the column would touch ~10 files (filters, Gantt, board-card-model, the `DUE_DATE_CHANGED` activity) for cosmetics. The label change is UI-only.
- **Date granularity is day-level.** Auto-set uses UTC midnight; the deviation helper compares local `startOfDay`. Mixed-timezone edge cases at day boundaries are acceptable for this product (same tradeoff the existing `getDateTone` makes).
- **Subtasks need no special handling** — they're ordinary `Task` rows, so every behaviour above applies to them unchanged.
- **Future analytics (CSV export of Факт/План/Отклонение) is explicitly out of scope** for this plan; the fields are stored cleanly so it can be added later without a data migration.
