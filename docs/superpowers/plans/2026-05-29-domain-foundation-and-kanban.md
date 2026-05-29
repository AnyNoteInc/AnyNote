# `@repo/domain` Foundation + Kanban (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a NodeNext-clean `@repo/domain` package holding the Kanban write logic (single source of truth), refactor the tRPC kanban procedures to consume it, and build the Kanban MCP tools in `apps/engines` on it (item 8 + UC3).

**Architecture:** `@repo/domain` exposes `fn(prisma, actorUserId, input) → result` functions that run transactions + `TaskActivity` audit + fractional positions + authorization, throwing `DomainError`. tRPC kanban procedures become thin wrappers (map `DomainError`→`TRPCError`, emit `kanbanBus`); engines wraps the same functions behind NL-resolving MCP tools (map `DomainError`→`HttpException`). Reads stay direct-Prisma in each consumer.

**Tech Stack:** TypeScript NodeNext (`@repo/domain` mirrors `@repo/db`), Prisma 7 (`@repo/db`), Zod, tRPC v11 (`@repo/trpc`), NestJS + `@rekog/mcp-nest` (engines), Vitest (domain/trpc) + Jest (engines).

**Spec:** [docs/superpowers/specs/2026-05-29-domain-foundation-and-kanban-design.md](docs/superpowers/specs/2026-05-29-domain-foundation-and-kanban-design.md)

**Conventions:**
- `@repo/domain` & consumers: relative imports use **explicit `.ts` extensions** (base tsconfig has `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`), matching `@repo/db`. Prettier: no semicolons, single quotes, 100-width.
- Domain functions: never import `@repo/auth`/`@repo/ui`/`@trpc/server`/`kanbanBus`. They take `prisma` + `actorUserId` + typed input, return data, throw `DomainError`.
- Commit per task; end body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.
- Domain tests: `pnpm --filter @repo/domain test` (vitest). tRPC: `pnpm --filter @repo/trpc test`. engines: `pnpm --filter engines test`.

**Verified procedure facts (ports must match these exactly):** see the originals in [packages/trpc/src/routers/kanban/task.ts](packages/trpc/src/routers/kanban/task.ts), [sprint.ts](packages/trpc/src/routers/kanban/sprint.ts), [comment.ts](packages/trpc/src/routers/kanban/comment.ts), [helpers.ts](packages/trpc/src/routers/kanban/helpers.ts), [packages/trpc/src/helpers/page-access.ts](packages/trpc/src/helpers/page-access.ts). Key: `move` needs `beforeId`/`afterId` (nullable); `sprint.activate` catches Prisma `P2002`→CONFLICT; `sprint.complete` moves only ACTIVE-column tasks of the sprint to `moveUndoneTo`; `task.update` writes per-field activity.

---

## Phase A — `@repo/domain` package + Kanban logic

### Task 1: Scaffold `@repo/domain` + `DomainError`

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts`, `packages/domain/src/errors.ts`
- Test: `packages/domain/test/errors.test.ts`

- [ ] **Step 1: Create the package scaffold**

`packages/domain/package.json`:
```json
{
  "name": "@repo/domain",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": { "types": "./src/index.ts", "import": "./src/index.ts", "default": "./src/index.ts" },
    "./*": { "types": "./src/*", "import": "./src/*", "default": "./src/*" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@repo/db": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^22.19.1",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

`packages/domain/tsconfig.json`:
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "types": ["node"] },
  "include": ["src"]
}
```

`packages/domain/src/errors.ts`:
```ts
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export const notFound = (message: string): DomainError => new DomainError('NOT_FOUND', message, 404)
export const forbidden = (message: string): DomainError => new DomainError('FORBIDDEN', message, 403)
export const badRequest = (message: string): DomainError => new DomainError('BAD_REQUEST', message, 400)
export const conflict = (message: string): DomainError => new DomainError('CONFLICT', message, 409)

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof Error && e.name === 'DomainError'
}
```

`packages/domain/src/index.ts`:
```ts
export * from './errors.ts'
```

- [ ] **Step 2: Write the failing test**

`packages/domain/test/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

import { DomainError, forbidden, isDomainError, notFound } from '../src/errors.ts'

describe('DomainError', () => {
  it('carries code + httpStatus and is detectable', () => {
    const e = forbidden('nope')
    expect(e).toBeInstanceOf(DomainError)
    expect(e.code).toBe('FORBIDDEN')
    expect(e.httpStatus).toBe(403)
    expect(isDomainError(e)).toBe(true)
    expect(isDomainError(new Error('x'))).toBe(false)
    expect(notFound('m').httpStatus).toBe(404)
  })
})
```

- [ ] **Step 3: Register the workspace package + run the test**

Run: `pnpm install` (registers `@repo/domain` in the workspace), then `pnpm --filter @repo/domain test`
Expected: PASS. Then `pnpm --filter @repo/domain check-types` → clean.

- [ ] **Step 4: Commit**

```bash
git add packages/domain pnpm-lock.yaml
git commit -m "feat(domain): scaffold @repo/domain package with DomainError"
```

### Task 2: Kanban `helpers.ts` + `access.ts`

**Files:**
- Create: `packages/domain/src/kanban/helpers.ts`, `packages/domain/src/kanban/access.ts`
- Test: `packages/domain/test/kanban/helpers.test.ts`, `packages/domain/test/kanban/access.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/domain/test/kanban/helpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

import { endPosition, positionBetween } from '../../src/kanban/helpers.ts'

describe('kanban position helpers', () => {
  it('positionBetween returns the midpoint, or gaps at the ends', () => {
    expect(positionBetween(1000, 2000)).toBe(1500)
    expect(positionBetween(1000, null)).toBe(2024)
    expect(positionBetween(null, 2000)).toBe(976)
    expect(positionBetween(null, null)).toBe(0)
  })

  it('endPosition returns max + gap, or 0 when empty', () => {
    expect(endPosition([])).toBe(0)
    expect(endPosition([{ position: 1024 }, { position: 4096 }])).toBe(5120)
  })
})
```

`packages/domain/test/kanban/access.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { assertPageAccess, assertPageOwnership } from '../../src/kanban/access.ts'

describe('kanban access', () => {
  const pageFindFirst = vi.fn()
  const memberFindUnique = vi.fn()
  const prisma = {
    page: { findFirst: pageFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
  } as unknown as PrismaClient

  beforeEach(() => vi.clearAllMocks())

  it('assertPageAccess returns the page for a workspace member', async () => {
    pageFindFirst.mockResolvedValue({ id: 'p1', workspaceId: 'w1', createdById: 'u9' })
    await expect(assertPageAccess(prisma, 'u1', 'p1')).resolves.toMatchObject({ id: 'p1' })
  })

  it('assertPageAccess throws NOT_FOUND for non-members', async () => {
    pageFindFirst.mockResolvedValue(null)
    await expect(assertPageAccess(prisma, 'u1', 'p1')).rejects.toBeInstanceOf(DomainError)
  })

  it('assertPageOwnership allows the creator', async () => {
    pageFindFirst.mockResolvedValue({ id: 'p1', workspaceId: 'w1', createdById: 'u1' })
    await expect(assertPageOwnership(prisma, 'u1', 'p1')).resolves.toMatchObject({ id: 'p1' })
    expect(memberFindUnique).not.toHaveBeenCalled()
  })

  it('assertPageOwnership allows a workspace OWNER who is not the creator', async () => {
    pageFindFirst.mockResolvedValue({ id: 'p1', workspaceId: 'w1', createdById: 'u9' })
    memberFindUnique.mockResolvedValue({ role: 'OWNER' })
    await expect(assertPageOwnership(prisma, 'u1', 'p1')).resolves.toMatchObject({ id: 'p1' })
  })

  it('assertPageOwnership rejects a non-owner non-creator', async () => {
    pageFindFirst.mockResolvedValue({ id: 'p1', workspaceId: 'w1', createdById: 'u9' })
    memberFindUnique.mockResolvedValue({ role: 'EDITOR' })
    await expect(assertPageOwnership(prisma, 'u1', 'p1')).rejects.toBeInstanceOf(DomainError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @repo/domain test`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `helpers.ts`** (ported verbatim from `@repo/trpc` kanban `helpers.ts`, minus `seedKanbanDefaults`/`DEFAULT_PRIORITY_COLORS` which stay in `@repo/trpc`)

`packages/domain/src/kanban/helpers.ts`:
```ts
import type { Prisma, TaskActivityType } from '@repo/db'
import { z } from 'zod'

export const POSITION_GAP = 1024
const PRECISION_FLOOR = Number.EPSILON * 1024

export const dateInput = z
  .preprocess((v) => {
    if (v === null || v === undefined) return v
    if (v instanceof Date) return v
    if (typeof v === 'string') {
      const parsed = new Date(v)
      return Number.isNaN(parsed.getTime()) ? v : parsed
    }
    return v
  }, z.date().nullable())
  .optional()

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) {
    const gap = next - prev
    if (gap < PRECISION_FLOOR) throw new Error('Position precision underflow — rebalance required')
    return prev + gap / 2
  }
  if (prev !== null) return prev + POSITION_GAP
  if (next !== null) return next - POSITION_GAP
  return 0
}

export function endPosition(items: { position: number }[]): number {
  let max: number | null = null
  for (const item of items) {
    if (max === null || item.position > max) max = item.position
  }
  return max === null ? 0 : max + POSITION_GAP
}

export async function recordActivity(
  tx: Prisma.TransactionClient,
  input: { taskId: string; actorId: string; type: TaskActivityType; payload?: Prisma.InputJsonValue },
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

- [ ] **Step 4: Implement `access.ts`** (ported from `@repo/trpc` `helpers/page-access.ts`, throwing `DomainError`, taking `(prisma, userId, pageId)`)

`packages/domain/src/kanban/access.ts`:
```ts
import type { PrismaClient } from '@repo/db'

import { forbidden, notFound } from '../errors.ts'

export async function assertPageAccess(prisma: PrismaClient, userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId } } } },
  })
  if (!page) throw notFound('Страница не найдена')
  return page
}

export async function assertPageOwnership(prisma: PrismaClient, userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId } } } },
  })
  if (!page) throw notFound('Страница не найдена')
  if (page.createdById === userId) return page
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId } },
  })
  if (member?.role !== 'OWNER') throw forbidden('Недостаточно прав')
  return page
}
```

- [ ] **Step 5: Run tests + check-types**

Run: `pnpm --filter @repo/domain test && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/kanban packages/domain/test/kanban
git commit -m "feat(domain): add kanban position helpers + page-access (DomainError)"
```

### Task 3: Kanban `schemas.ts` + `tasks.ts`

**Files:**
- Create: `packages/domain/src/kanban/schemas.ts`, `packages/domain/src/kanban/tasks.ts`
- Test: `packages/domain/test/kanban/tasks.test.ts`

- [ ] **Step 1: Create `schemas.ts`** (the zod input contracts, reused by tRPC `.input` and as the typed args)

`packages/domain/src/kanban/schemas.ts`:
```ts
import { z } from 'zod'

import { dateInput } from './helpers.ts'

export const createTaskInput = z.object({
  pageId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  typeId: z.string().uuid().optional(),
  priorityId: z.string().uuid().optional(),
  sprintId: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
})
export type CreateTaskInput = z.infer<typeof createTaskInput>

export const updateTaskInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.unknown().optional(),
  startDate: dateInput,
  dueDate: dateInput,
  typeId: z.string().uuid().nullable().optional(),
  priorityId: z.string().uuid().nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
  sprintPosition: z.number().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
})
export type UpdateTaskInput = z.infer<typeof updateTaskInput>

export const moveTaskInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  targetColumnId: z.string().uuid(),
  beforeId: z.string().uuid().nullable(),
  afterId: z.string().uuid().nullable(),
})
export type MoveTaskInput = z.infer<typeof moveTaskInput>

export const setTaskAssigneesInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  userIds: z.array(z.string().uuid()),
})
export type SetTaskAssigneesInput = z.infer<typeof setTaskAssigneesInput>

export const taskIdInput = z.object({ pageId: z.string().uuid(), id: z.string().uuid() })
export type TaskIdInput = z.infer<typeof taskIdInput>

export const createSprintInput = z.object({
  pageId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  startDate: dateInput,
  endDate: dateInput,
})
export type CreateSprintInput = z.infer<typeof createSprintInput>

export const sprintIdInput = z.object({ pageId: z.string().uuid(), id: z.string().uuid() })
export type SprintIdInput = z.infer<typeof sprintIdInput>

export const completeSprintInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  moveUndoneTo: z.string().uuid().nullable(),
})
export type CompleteSprintInput = z.infer<typeof completeSprintInput>

export const createTaskCommentInput = z.object({
  pageId: z.string().uuid(),
  taskId: z.string().uuid(),
  content: z.unknown(),
})
export type CreateTaskCommentInput = z.infer<typeof createTaskCommentInput>
```

- [ ] **Step 2: Write the failing test**

`packages/domain/test/kanban/tasks.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { archiveTask, createTask, moveTask } from '../../src/kanban/tasks.ts'

function prismaWith(over: Record<string, unknown>) {
  const tx = {
    task: { create: vi.fn(async (a: { data: unknown }) => ({ id: 't1', ...(a.data as object) })), update: vi.fn(async () => ({ id: 't1' })) },
    taskActivity: { create: vi.fn(async () => ({})) },
    ...over,
  }
  return {
    page: { findFirst: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u1' })) },
    kanbanColumn: { findFirst: vi.fn(async () => ({ id: 'c1' })), findMany: vi.fn(async () => [{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }, { id: 'c2', title: 'Done', kind: 'DONE' }]) },
    kanbanType: { findFirst: vi.fn(async () => null) },
    kanbanPriority: { findFirst: vi.fn(async () => null) },
    sprint: { findFirst: vi.fn(async () => ({ id: 's1' })) },
    task: { findMany: vi.fn(async () => []), findUniqueOrThrow: vi.fn(async () => ({ id: 't1', pageId: 'b1', columnId: 'c1' })), update: tx.task.update },
    taskActivity: { create: tx.taskActivity.create },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    __tx: tx,
  } as unknown as PrismaClient & { __tx: typeof tx }
}

describe('domain kanban tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createTask records a CREATED activity and uses the first column when none given', async () => {
    const prisma = prismaWith({})
    const out = await createTask(prisma, 'u1', { pageId: 'b1', title: 'Ship' })
    expect(out.id).toBe('t1')
    expect((prisma as unknown as { __tx: { task: { create: ReturnType<typeof vi.fn> } } }).__tx.task.create).toHaveBeenCalled()
    expect((prisma as unknown as { __tx: { taskActivity: { create: ReturnType<typeof vi.fn> } } }).__tx.taskActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'CREATED' }) }),
    )
  })

  it('moveTask writes MOVED and STATUS_CHANGED when kind differs (Todo→Done)', async () => {
    const prisma = prismaWith({})
    await moveTask(prisma, 'u1', { pageId: 'b1', id: 't1', targetColumnId: 'c2', beforeId: null, afterId: null })
    const tx = (prisma as unknown as { __tx: { taskActivity: { create: ReturnType<typeof vi.fn> } } }).__tx
    const types = tx.taskActivity.create.mock.calls.map((c) => (c[0] as { data: { type: string } }).data.type)
    expect(types).toContain('MOVED')
    expect(types).toContain('STATUS_CHANGED')
  })

  it('archiveTask throws NOT_FOUND for a task on another page', async () => {
    const prisma = prismaWith({})
    ;(prisma.task.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', pageId: 'other' })
    await expect(archiveTask(prisma, 'u1', { pageId: 'b1', id: 't1' })).rejects.toBeInstanceOf(DomainError)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- tasks`
Expected: FAIL — `tasks.ts` missing.

- [ ] **Step 4: Implement `tasks.ts`** — port `task.create/update/move/setAssignees/archive` from [packages/trpc/src/routers/kanban/task.ts](packages/trpc/src/routers/kanban/task.ts), with these exact transforms: `ctx.prisma`→`prisma`, `ctx.user.id`→`actorUserId`, `assertPageAccess(ctx, x)`→`assertPageAccess(prisma, actorUserId, x)`, `new TRPCError({code:'NOT_FOUND',...})`→`notFound(...)`, `'BAD_REQUEST'`→`badRequest(...)`, remove all `kanbanBus.emit(...)` lines, return the same value.

`packages/domain/src/kanban/tasks.ts`:
```ts
import type { PrismaClient } from '@repo/db'

import { badRequest, notFound } from '../errors.ts'
import { assertPageAccess } from './access.ts'
import { endPosition, positionBetween, recordActivity } from './helpers.ts'
import type {
  CreateTaskInput,
  MoveTaskInput,
  SetTaskAssigneesInput,
  TaskIdInput,
  UpdateTaskInput,
} from './schemas.ts'

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.getTime() === b.getTime()
}
function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

export async function createTask(prisma: PrismaClient, actorUserId: string, input: CreateTaskInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const column = input.columnId
    ? await prisma.kanbanColumn.findFirst({ where: { id: input.columnId, pageId: page.id } })
    : await prisma.kanbanColumn.findFirst({ where: { pageId: page.id }, orderBy: { position: 'asc' } })
  if (!column) throw badRequest('У доски нет колонок — создайте хотя бы одну')

  if (input.sprintId) {
    const sprint = await prisma.sprint.findFirst({ where: { id: input.sprintId, pageId: page.id } })
    if (!sprint) throw badRequest('Спринт не найден')
  }

  const [type, priority] = await Promise.all([
    input.typeId
      ? prisma.kanbanType.findFirst({ where: { id: input.typeId, pageId: page.id } })
      : prisma.kanbanType.findFirst({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
    input.priorityId
      ? prisma.kanbanPriority.findFirst({ where: { id: input.priorityId, pageId: page.id } })
      : prisma.kanbanPriority.findFirst({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
  ])

  const tasksInColumn = await prisma.task.findMany({
    where: { pageId: page.id, columnId: column.id, deletedAt: null },
    select: { position: true },
  })
  const tasksInSprint = input.sprintId
    ? await prisma.task.findMany({
        where: { pageId: page.id, sprintId: input.sprintId, deletedAt: null },
        select: { sprintPosition: true },
      })
    : []
  const sprintPosition = input.sprintId
    ? endPosition(tasksInSprint.map((task) => ({ position: task.sprintPosition ?? 0 })))
    : null

  return prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        pageId: page.id,
        columnId: column.id,
        typeId: type?.id ?? null,
        priorityId: priority?.id ?? null,
        title: input.title,
        position: endPosition(tasksInColumn),
        sprintId: input.sprintId ?? null,
        sprintPosition,
        createdById: actorUserId,
      },
    })
    await recordActivity(tx, { taskId: created.id, actorId: actorUserId, type: 'CREATED' })
    return created
  })
}

export async function updateTask(prisma: PrismaClient, actorUserId: string, input: UpdateTaskInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const current = await prisma.task.findUniqueOrThrow({
    where: { id: input.id },
    select: { id: true, pageId: true, title: true, dueDate: true, startDate: true, typeId: true, priorityId: true, sprintId: true, parentId: true },
  })
  if (current.pageId !== page.id) throw notFound('Задача не найдена')

  return prisma.$transaction(async (tx) => {
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
        sprintPosition: input.sprintPosition,
        parentId: input.parentId,
        updatedById: actorUserId,
      },
    })
    if (input.title !== undefined && input.title !== current.title)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'RENAMED' })
    if (input.description !== undefined)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'DESCRIPTION_CHANGED' })
    if (input.dueDate !== undefined && !sameDate(current.dueDate, input.dueDate))
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'DUE_DATE_CHANGED', payload: { from: toIso(current.dueDate), to: toIso(input.dueDate) } })
    if (input.startDate !== undefined && !sameDate(current.startDate, input.startDate))
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'START_DATE_CHANGED', payload: { from: toIso(current.startDate), to: toIso(input.startDate) } })
    if (input.typeId !== undefined && input.typeId !== current.typeId)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'TYPE_CHANGED', payload: { fromId: current.typeId, toId: input.typeId } })
    if (input.priorityId !== undefined && input.priorityId !== current.priorityId)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'PRIORITY_CHANGED', payload: { fromId: current.priorityId, toId: input.priorityId } })
    if (input.sprintId !== undefined && input.sprintId !== current.sprintId)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'SPRINT_CHANGED', payload: { fromId: current.sprintId, toId: input.sprintId } })
    if (input.parentId !== undefined && input.parentId !== current.parentId)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'PARENT_CHANGED', payload: { fromId: current.parentId, toId: input.parentId } })
    return updated
  })
}

export async function moveTask(prisma: PrismaClient, actorUserId: string, input: MoveTaskInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const current = await prisma.task.findUniqueOrThrow({
    where: { id: input.id },
    select: { id: true, pageId: true, columnId: true },
  })
  if (current.pageId !== page.id) throw notFound('Задача не найдена')

  const columns = await prisma.kanbanColumn.findMany({
    where: { pageId: page.id },
    select: { id: true, title: true, kind: true },
  })
  const fromColumn = columns.find((c) => c.id === current.columnId)
  const toColumn = columns.find((c) => c.id === input.targetColumnId)
  if (!toColumn) throw badRequest('Колонка назначения не найдена')

  const tasksInTarget = await prisma.task.findMany({
    where: { pageId: page.id, columnId: input.targetColumnId, deletedAt: null, NOT: { id: input.id } },
    select: { id: true, position: true },
  })
  const prev = input.beforeId ? (tasksInTarget.find((t) => t.id === input.beforeId)?.position ?? null) : null
  const next = input.afterId ? (tasksInTarget.find((t) => t.id === input.afterId)?.position ?? null) : null
  const position = positionBetween(prev, next)

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: input.id },
      data: { columnId: input.targetColumnId, position, updatedById: actorUserId },
    })
    await recordActivity(tx, {
      taskId: current.id,
      actorId: actorUserId,
      type: 'MOVED',
      payload: { fromColumnId: current.columnId, toColumnId: input.targetColumnId, fromColumnTitle: fromColumn?.title ?? null, toColumnTitle: toColumn.title },
    })
    if (fromColumn && fromColumn.kind !== toColumn.kind) {
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'STATUS_CHANGED', payload: { fromKind: fromColumn.kind, toKind: toColumn.kind } })
    }
    return updated
  })
}

export async function setTaskAssignees(prisma: PrismaClient, actorUserId: string, input: SetTaskAssigneesInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const current = await prisma.task.findUniqueOrThrow({
    where: { id: input.id },
    select: { id: true, pageId: true, assignees: { select: { userId: true } } },
  })
  if (current.pageId !== page.id) throw notFound('Задача не найдена')
  const currentIds = new Set(current.assignees.map((a) => a.userId))
  const targetIds = new Set(input.userIds)
  const toRemove = [...currentIds].filter((id) => !targetIds.has(id))
  const toAdd = [...targetIds].filter((id) => !currentIds.has(id))

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) await tx.taskAssignee.deleteMany({ where: { taskId: input.id, userId: { in: toRemove } } })
    if (toAdd.length > 0) await tx.taskAssignee.createMany({ data: toAdd.map((userId) => ({ taskId: input.id, userId })) })
    const activityRows = [
      ...toRemove.map((userId) => ({ taskId: input.id, actorId: actorUserId, type: 'UNASSIGNED' as const, payload: { userId } })),
      ...toAdd.map((userId) => ({ taskId: input.id, actorId: actorUserId, type: 'ASSIGNED' as const, payload: { userId } })),
    ]
    if (activityRows.length > 0) await tx.taskActivity.createMany({ data: activityRows })
  })
  return { ok: true as const }
}

export async function archiveTask(prisma: PrismaClient, actorUserId: string, input: TaskIdInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const task = await prisma.task.findUniqueOrThrow({ where: { id: input.id }, select: { pageId: true } })
  if (task.pageId !== page.id) throw notFound('Задача не найдена')
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: input.id }, data: { archived: true, updatedById: actorUserId } })
    await recordActivity(tx, { taskId: input.id, actorId: actorUserId, type: 'ARCHIVED' })
  })
  return { ok: true as const }
}
```

- [ ] **Step 5: Run test + check-types**

Run: `pnpm --filter @repo/domain test -- tasks && pnpm --filter @repo/domain check-types`
Expected: PASS. (If Prisma's `task.create` `data` rejects scalar FKs, that mirrors the original procedure which uses the same shape — it works.)

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/kanban/schemas.ts packages/domain/src/kanban/tasks.ts packages/domain/test/kanban/tasks.test.ts
git commit -m "feat(domain): port kanban task write operations"
```

### Task 4: Kanban `sprints.ts` + `comments.ts` + barrels

**Files:**
- Create: `packages/domain/src/kanban/sprints.ts`, `packages/domain/src/kanban/comments.ts`, `packages/domain/src/kanban/index.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/kanban/sprints.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/domain/test/kanban/sprints.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { activateSprint, completeSprint, createSprint } from '../../src/kanban/sprints.ts'

function ownerPrisma() {
  const tx = {
    sprint: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({ id: 's1' })), findUnique: vi.fn(async () => ({ id: 's1', pageId: 'b1' })) },
    task: { updateMany: vi.fn(async () => ({ count: 2 })) },
    kanbanColumn: { findMany: vi.fn(async () => [{ id: 'c1' }]) },
  }
  return {
    page: { findFirst: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u1' })) },
    workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    sprint: { findMany: vi.fn(async () => []), create: vi.fn(async (a: { data: unknown }) => ({ id: 's1', ...(a.data as object) })) },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    __tx: tx,
  } as unknown as PrismaClient & { __tx: typeof tx }
}

describe('domain kanban sprints', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createSprint creates a PLANNED sprint (owner-gated)', async () => {
    const prisma = ownerPrisma()
    const out = await createSprint(prisma, 'u1', { pageId: 'b1', name: 'Sprint 1' })
    expect(out.id).toBe('s1')
  })

  it('activateSprint demotes others then promotes target', async () => {
    const prisma = ownerPrisma()
    await activateSprint(prisma, 'u1', { pageId: 'b1', id: 's1' })
    const tx = (prisma as unknown as { __tx: { sprint: { updateMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } } }).__tx
    expect(tx.sprint.updateMany).toHaveBeenCalled()
    expect(tx.sprint.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ACTIVE' } }))
  })

  it('completeSprint rejects when moveUndoneTo === id', async () => {
    const prisma = ownerPrisma()
    await expect(completeSprint(prisma, 'u1', { pageId: 'b1', id: 's1', moveUndoneTo: 's1' })).rejects.toBeInstanceOf(DomainError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- sprints`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `sprints.ts`** — port `sprint.create/activate/complete` from [sprint.ts](packages/trpc/src/routers/kanban/sprint.ts) (`assertPageOwnership`, `DomainError`, P2002→`conflict`, no emit)

`packages/domain/src/kanban/sprints.ts`:
```ts
import type { PrismaClient } from '@repo/db'

import { badRequest, conflict, notFound } from '../errors.ts'
import { assertPageOwnership } from './access.ts'
import { endPosition } from './helpers.ts'
import type { CompleteSprintInput, CreateSprintInput, SprintIdInput } from './schemas.ts'

export async function createSprint(prisma: PrismaClient, actorUserId: string, input: CreateSprintInput) {
  const page = await assertPageOwnership(prisma, actorUserId, input.pageId)
  const existing = await prisma.sprint.findMany({ where: { pageId: page.id }, select: { position: true } })
  return prisma.sprint.create({
    data: {
      pageId: page.id,
      name: input.name,
      description: input.description ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      status: 'PLANNED',
      position: endPosition(existing),
    },
  })
}

export async function activateSprint(prisma: PrismaClient, actorUserId: string, input: SprintIdInput) {
  const page = await assertPageOwnership(prisma, actorUserId, input.pageId)
  try {
    await prisma.$transaction(async (tx) => {
      await tx.sprint.updateMany({ where: { pageId: page.id, status: 'ACTIVE', NOT: { id: input.id } }, data: { status: 'PLANNED' } })
      await tx.sprint.update({ where: { id: input.id, pageId: page.id }, data: { status: 'ACTIVE' } })
    })
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') throw conflict('Активный спринт уже существует — попробуйте ещё раз')
    throw e
  }
  return { ok: true as const }
}

export async function completeSprint(prisma: PrismaClient, actorUserId: string, input: CompleteSprintInput) {
  const page = await assertPageOwnership(prisma, actorUserId, input.pageId)
  if (input.moveUndoneTo === input.id) throw badRequest('Невозможно перенести задачи в тот же спринт')
  await prisma.$transaction(async (tx) => {
    const [sprint, dest, undoneColumns] = await Promise.all([
      tx.sprint.findUnique({ where: { id: input.id }, select: { id: true, pageId: true } }),
      input.moveUndoneTo
        ? tx.sprint.findUnique({ where: { id: input.moveUndoneTo }, select: { id: true, pageId: true } })
        : Promise.resolve(null),
      tx.kanbanColumn.findMany({ where: { pageId: page.id, kind: 'ACTIVE' }, select: { id: true } }),
    ])
    if (!sprint || sprint.pageId !== page.id) throw notFound('Спринт не найден')
    if (input.moveUndoneTo && (!dest || dest.pageId !== page.id)) throw notFound('Целевой спринт не найден на этой доске')
    const undoneColumnIds = undoneColumns.map((c) => c.id)
    await tx.task.updateMany({
      where: { sprintId: input.id, columnId: { in: undoneColumnIds } },
      data: { sprintId: input.moveUndoneTo, sprintPosition: null },
    })
    await tx.sprint.update({ where: { id: input.id }, data: { status: 'COMPLETED' } })
  })
  return { ok: true as const }
}
```

- [ ] **Step 4: Implement `comments.ts`** — port `comment.create` from [comment.ts](packages/trpc/src/routers/kanban/comment.ts)

`packages/domain/src/kanban/comments.ts`:
```ts
import type { PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import { assertPageAccess } from './access.ts'
import { recordActivity } from './helpers.ts'
import type { CreateTaskCommentInput } from './schemas.ts'

export async function createTaskComment(prisma: PrismaClient, actorUserId: string, input: CreateTaskCommentInput) {
  await assertPageAccess(prisma, actorUserId, input.pageId)
  const task = await prisma.task.findUniqueOrThrow({ where: { id: input.taskId }, select: { pageId: true } })
  if (task.pageId !== input.pageId) throw notFound('Задача не найдена')
  return prisma.$transaction(async (tx) => {
    const created = await tx.taskComment.create({
      data: { taskId: input.taskId, authorId: actorUserId, content: input.content as never },
    })
    await recordActivity(tx, { taskId: input.taskId, actorId: actorUserId, type: 'COMMENTED', payload: { commentId: created.id } })
    return created
  })
}
```

- [ ] **Step 5: Barrels** — `packages/domain/src/kanban/index.ts`:
```ts
export * from './access.ts'
export * from './comments.ts'
export * from './helpers.ts'
export * from './schemas.ts'
export * from './sprints.ts'
export * from './tasks.ts'
```
Update `packages/domain/src/index.ts` (flat re-export so consumers can `import * as domain from '@repo/domain'` and resolution is clean under both NodeNext and Bundler via the `.` export):
```ts
export * from './errors.ts'
export * from './kanban/index.ts'
```

- [ ] **Step 6: Run tests + check-types, commit**

Run: `pnpm --filter @repo/domain test && pnpm --filter @repo/domain check-types`
Expected: PASS.
```bash
git add packages/domain/src/kanban packages/domain/src/index.ts packages/domain/test/kanban/sprints.test.ts
git commit -m "feat(domain): port kanban sprint + comment operations; barrels"
```

## Phase B — tRPC consumes `@repo/domain`

### Task 5: Refactor tRPC kanban procedures to thin wrappers

**Files:**
- Modify: `packages/trpc/package.json` (add `@repo/domain`)
- Create: `packages/trpc/src/helpers/map-domain.ts`
- Modify: `packages/trpc/src/routers/kanban/helpers.ts` (re-export moved helpers)
- Modify: `packages/trpc/src/routers/kanban/task.ts`, `sprint.ts`, `comment.ts` (migrated procedures → wrappers)
- Tests: the existing `packages/trpc/test/**/kanban*` suite must keep passing (regression guard); + `packages/trpc/test/map-domain.test.ts` (create)

- [ ] **Step 1: Add the dep + a `mapDomain` test**

Add `"@repo/domain": "workspace:*"` to `packages/trpc/package.json` `dependencies`. Run `pnpm install`.

Create `packages/trpc/test/map-domain.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { TRPCError } from '@trpc/server'
import { forbidden } from '@repo/domain'

import { mapDomain } from '../src/helpers/map-domain'

describe('mapDomain', () => {
  it('translates DomainError → TRPCError by httpStatus', async () => {
    await expect(mapDomain(async () => { throw forbidden('nope') })).rejects.toMatchObject({
      name: 'TRPCError',
      code: 'FORBIDDEN',
    })
  })
  it('passes non-domain errors through', async () => {
    const e = new Error('boom')
    await expect(mapDomain(async () => { throw e })).rejects.toBe(e)
  })
  it('returns the value on success', async () => {
    await expect(mapDomain(async () => 42)).resolves.toBe(42)
  })
})
```

- [ ] **Step 2: Run → FAIL** (`mapDomain` missing). Run: `pnpm --filter @repo/trpc test -- map-domain`.

- [ ] **Step 3: Implement `mapDomain`**

`packages/trpc/src/helpers/map-domain.ts`:
```ts
import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server'
import { isDomainError } from '@repo/domain'

const HTTP_TO_TRPC: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
}

export async function mapDomain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (isDomainError(e)) {
      throw new TRPCError({ code: HTTP_TO_TRPC[e.httpStatus] ?? 'BAD_REQUEST', message: e.message })
    }
    throw e
  }
}
```

- [ ] **Step 4: Re-export moved helpers from `@repo/domain`**

Replace the `positionBetween`/`endPosition`/`recordActivity`/`dateInput`/`POSITION_GAP` definitions in `packages/trpc/src/routers/kanban/helpers.ts` with a re-export, and KEEP `seedKanbanDefaults` + `DEFAULT_PRIORITY_COLORS` (they are tRPC-only seeding, not domain logic). Top of the file:
```ts
import type { Prisma } from '@repo/db'
export { POSITION_GAP, dateInput, endPosition, positionBetween, recordActivity } from '@repo/domain'
```
(Leave `DEFAULT_PRIORITY_COLORS`, `TxClient`, and `seedKanbanDefaults` exactly as they are. They reference no removed local — `seedKanbanDefaults` uses literal positions.) Non-migrated routers (`column`/`type`/`priority`/`label`, `task.setLabels`/`softDelete`/`unarchive`, `sprint.reorder`/`update`/`delete`, `comment.update`/`delete`) keep importing from `./helpers` unchanged.

- [ ] **Step 5: Refactor migrated procedures in `task.ts`**

In `packages/trpc/src/routers/kanban/task.ts`, add imports:
```ts
import * as domain from '@repo/domain'
import { mapDomain } from '../../helpers/map-domain'
```
Replace the `create`, `update`, `move`, `setAssignees`, `archive` procedures' `.input(...)` + `.mutation(...)` with thin wrappers (delete their old inline logic; keep `setLabels`, `softDelete`, `unarchive` untouched):
```ts
  create: protectedProcedure
    .input(domain.createTaskInput)
    .mutation(async ({ ctx, input }) => {
      const task = await mapDomain(() => domain.createTask(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.created', taskId: task.id })
      return task
    }),

  update: protectedProcedure
    .input(domain.updateTaskInput)
    .mutation(async ({ ctx, input }) => {
      const task = await mapDomain(() => domain.updateTask(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.updated', taskId: task.id })
      return task
    }),

  move: protectedProcedure
    .input(domain.moveTaskInput)
    .mutation(async ({ ctx, input }) => {
      const task = await mapDomain(() => domain.moveTask(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.moved', taskId: task.id })
      return task
    }),

  setAssignees: protectedProcedure
    .input(domain.setTaskAssigneesInput)
    .mutation(async ({ ctx, input }) => {
      const res = await mapDomain(() => domain.setTaskAssignees(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.updated', taskId: input.id })
      return res
    }),

  archive: protectedProcedure
    .input(domain.taskIdInput)
    .mutation(async ({ ctx, input }) => {
      const res = await mapDomain(() => domain.archiveTask(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.updated', taskId: input.id })
      return res
    }),
```
After this, `task.ts` no longer references `positionBetween`/`endPosition` directly in the migrated procedures, but `setLabels`/`unarchive` still use `recordActivity`/`assertPageAccess` from their existing imports — leave those imports. (If `dateInput` was imported only for the migrated `.input`s, it can stay imported via `./helpers` harmlessly, or be removed if unused — let `lint`/`check-types` guide.)

- [ ] **Step 6: Refactor migrated procedures in `sprint.ts` + `comment.ts`**

`sprint.ts` — add `import * as domain from '@repo/domain'` + `import { mapDomain } from '../../helpers/map-domain'`; replace `create`, `activate`, `complete` (keep `update`, `reorder`, `delete`):
```ts
  create: protectedProcedure
    .input(domain.createSprintInput)
    .mutation(async ({ ctx, input }) => {
      const sprint = await mapDomain(() => domain.createSprint(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'sprint.upserted', sprintId: sprint.id })
      return sprint
    }),

  activate: protectedProcedure
    .input(domain.sprintIdInput)
    .mutation(async ({ ctx, input }) => {
      const res = await mapDomain(() => domain.activateSprint(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'sprint.upserted', sprintId: input.id })
      return res
    }),

  complete: protectedProcedure
    .input(domain.completeSprintInput)
    .mutation(async ({ ctx, input }) => {
      const res = await mapDomain(() => domain.completeSprint(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'sprint.upserted', sprintId: input.id })
      if (input.moveUndoneTo) kanbanBus.emit(input.pageId, { kind: 'sprint.upserted', sprintId: input.moveUndoneTo })
      return res
    }),
```
`comment.ts` — add the two imports; replace `create` (keep `list`, `update`, `delete`):
```ts
  create: protectedProcedure
    .input(domain.createTaskCommentInput)
    .mutation(async ({ ctx, input }) => {
      const comment = await mapDomain(() => domain.createTaskComment(ctx.prisma, ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'comment.upserted', taskId: input.taskId, commentId: comment.id })
      return comment
    }),
```

- [ ] **Step 7: Run the kanban regression suite + types + lint**

Run: `pnpm --filter @repo/domain build && pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types && pnpm --filter @repo/trpc lint`
Expected: PASS — the existing kanban procedure tests still green (behavior preserved), types clean, lint clean (no unused imports). If a kanban test asserts an exact `TRPCError` message that differed, reconcile (the domain messages were ported verbatim, so they should match).

- [ ] **Step 8: Commit**

```bash
git add packages/trpc/package.json packages/trpc/src/helpers/map-domain.ts packages/trpc/src/routers/kanban packages/trpc/test/map-domain.test.ts pnpm-lock.yaml
git commit -m "refactor(trpc): kanban procedures delegate to @repo/domain (single source)"
```

---

## Phase C — engines Kanban MCP tools (consume `@repo/domain`)

### Task 6: `KanbanGateway` (engines: resolvers, board guard, DomainError→HttpException)

**Files:**
- Modify: `apps/engines/package.json` (add `@repo/domain`)
- Create: `apps/engines/src/apps/mcp/services/kanban-gateway.service.ts` (+ `.spec.ts`)

- [ ] **Step 1: Add the dep**

Add `"@repo/domain": "workspace:*"` to `apps/engines/package.json` `dependencies`. Run `pnpm install`.

- [ ] **Step 2: Write the failing test**

`apps/engines/src/apps/mcp/services/kanban-gateway.service.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { BadRequestException, HttpException } from '@nestjs/common'
import { forbidden } from '@repo/domain'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { KanbanGateway, mapDomainError } from './kanban-gateway.service.js'

describe('mapDomainError', () => {
  it('maps DomainError → HttpException with its status', () => {
    const mapped = mapDomainError(forbidden('nope'))
    expect(mapped).toBeInstanceOf(HttpException)
    expect((mapped as HttpException).getStatus()).toBe(403)
  })
  it('passes non-domain errors through', () => {
    const e = new Error('x')
    expect(mapDomainError(e)).toBe(e)
  })
})

describe('KanbanGateway', () => {
  const pageFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const pageFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const columnFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const sprintFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const sprintFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    page: { findFirst: pageFindFirst, findMany: pageFindMany },
    kanbanColumn: { findMany: columnFindMany },
    sprint: { findFirst: sprintFindFirst, findMany: sprintFindMany },
  } as unknown as PrismaClient
  let gw: KanbanGateway

  beforeEach(() => {
    jest.clearAllMocks()
    gw = new KanbanGateway(prisma)
  })

  it('assertBoard accepts a KANBAN page in the workspace', async () => {
    pageFindFirst.mockResolvedValue({ id: 'b1' })
    await expect(gw.assertBoard('u1', 'w1', 'b1')).resolves.toEqual({ id: 'b1' })
  })
  it('assertBoard throws PageNotFoundError otherwise', async () => {
    pageFindFirst.mockResolvedValue(null)
    await expect(gw.assertBoard('u1', 'w1', 'b1')).rejects.toBeInstanceOf(PageNotFoundError)
  })
  it('resolveBoardPageId auto-selects the single board', async () => {
    pageFindMany.mockResolvedValue([{ id: 'only', title: 'Dev' }])
    expect(await gw.resolveBoardPageId('u1', 'w1', undefined)).toBe('only')
  })
  it('resolveBoardPageId errors when multiple boards and none given', async () => {
    pageFindMany.mockResolvedValue([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
    await expect(gw.resolveBoardPageId('u1', 'w1', undefined)).rejects.toBeInstanceOf(BadRequestException)
  })
  it('resolveColumnByStatus matches case-insensitively, else throws', async () => {
    columnFindMany.mockResolvedValue([{ id: 'c2', title: 'In Progress', kind: 'ACTIVE' }])
    expect(await gw.resolveColumnByStatus('b1', 'in progress')).toBe('c2')
    await expect(gw.resolveColumnByStatus('b1', 'Nope')).rejects.toBeInstanceOf(BadRequestException)
  })
  it('resolveSprintTarget: backlog→null, current→active id', async () => {
    sprintFindFirst.mockResolvedValue({ id: 's-active' })
    expect(await gw.resolveSprintTarget('b1', 'backlog')).toBeNull()
    expect(await gw.resolveSprintTarget('b1', 'current')).toBe('s-active')
  })
})
```

- [ ] **Step 3: Run → FAIL.** `pnpm --filter engines test -- kanban-gateway`.

- [ ] **Step 4: Implement the gateway**

`apps/engines/src/apps/mcp/services/kanban-gateway.service.ts`:
```ts
import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common'
import { isDomainError } from '@repo/domain'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'

/** Translate a @repo/domain DomainError into an MCP HttpException. */
export function mapDomainError(e: unknown): unknown {
  if (isDomainError(e)) return new HttpException({ code: `KANBAN_${e.code}`, message: e.message }, e.httpStatus)
  return e
}

@Injectable()
export class KanbanGateway {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  get db(): PrismaClient {
    return this.prisma
  }

  /** Run a domain call, mapping DomainError → HttpException. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw mapDomainError(e)
    }
  }

  async assertBoard(userId: string, workspaceId: string, boardPageId: string): Promise<{ id: string }> {
    const page = await this.prisma.page.findFirst({
      where: { id: boardPageId, type: 'KANBAN', workspaceId, workspace: { members: { some: { userId } } } },
      select: { id: true },
    })
    if (!page) throw new PageNotFoundError(boardPageId)
    return page
  }

  async resolveBoardPageId(userId: string, workspaceId: string, boardPageId?: string | null): Promise<string> {
    if (boardPageId) {
      await this.assertBoard(userId, workspaceId, boardPageId)
      return boardPageId
    }
    const boards = await this.prisma.page.findMany({
      where: { workspaceId, type: 'KANBAN', deletedAt: null, archived: false, workspace: { members: { some: { userId } } } },
      select: { id: true, title: true },
      take: 50,
    })
    if (boards.length === 0) throw new BadRequestException('No Kanban boards in this workspace')
    if (boards.length > 1) {
      const list = boards.map((b) => `"${b.title ?? ''}" (${b.id})`).join('; ')
      throw new BadRequestException(`Multiple Kanban boards — pass boardPageId. Boards: ${list}`)
    }
    return boards[0]!.id
  }

  async resolveColumnByStatus(boardPageId: string, status: string): Promise<string> {
    const columns = await this.prisma.kanbanColumn.findMany({ where: { pageId: boardPageId }, select: { id: true, title: true, kind: true } })
    const want = status.trim().toLowerCase()
    const hit = columns.find((c) => c.title.trim().toLowerCase() === want)
    if (!hit) throw new BadRequestException(`Unknown status "${status}". Available columns: ${columns.map((c) => `"${c.title}"`).join(', ') || '(none)'}`)
    return hit.id
  }

  async findCancelColumn(boardPageId: string): Promise<string | null> {
    const columns = await this.prisma.kanbanColumn.findMany({ where: { pageId: boardPageId }, select: { id: true, kind: true } })
    return columns.find((c) => c.kind === 'CANCELLED')?.id ?? null
  }

  async resolveSprintTarget(boardPageId: string, target: string): Promise<string | null> {
    const t = target.trim()
    if (t.toLowerCase() === 'backlog') return null
    if (t.toLowerCase() === 'current') {
      const active = await this.prisma.sprint.findFirst({ where: { pageId: boardPageId, status: 'ACTIVE' }, select: { id: true } })
      if (!active) throw new BadRequestException('No active sprint on this board')
      return active.id
    }
    const sprints = await this.prisma.sprint.findMany({ where: { pageId: boardPageId }, select: { id: true, name: true, status: true, position: true }, orderBy: { position: 'asc' } })
    if (t.toLowerCase() === 'next') {
      const active = sprints.find((s) => s.status === 'ACTIVE')
      const planned = sprints.filter((s) => s.status === 'PLANNED')
      const next = active ? planned.find((s) => s.position > active.position) ?? planned[0] : planned[0]
      if (!next) throw new BadRequestException('No next (planned) sprint on this board')
      return next.id
    }
    const byName = sprints.find((s) => s.name.trim().toLowerCase() === t.toLowerCase())
    if (byName) return byName.id
    const byId = sprints.find((s) => s.id === t)
    if (byId) return byId.id
    throw new BadRequestException(`Sprint not found: "${target}"`)
  }

  async resolveTypeByName(boardPageId: string, value: string): Promise<string> {
    const types = await this.prisma.kanbanType.findMany({ where: { pageId: boardPageId }, select: { id: true, title: true } })
    const v = value.trim().toLowerCase()
    const hit = types.find((t) => t.id === value || t.title.trim().toLowerCase() === v)
    if (!hit) throw new BadRequestException(`Unknown task type "${value}". Available: ${types.map((t) => `"${t.title}"`).join(', ')}`)
    return hit.id
  }

  async resolvePriorityByName(boardPageId: string, value: string): Promise<string> {
    const priorities = await this.prisma.kanbanPriority.findMany({ where: { pageId: boardPageId }, select: { id: true, title: true } })
    const v = value.trim().toLowerCase()
    const hit = priorities.find((p) => p.id === value || p.title.trim().toLowerCase() === v)
    if (!hit) throw new BadRequestException(`Unknown priority "${value}". Available: ${priorities.map((p) => `"${p.title}"`).join(', ')}`)
    return hit.id
  }

  resolveAssignee(callerUserId: string, value: string): string {
    return value === 'me' ? callerUserId : value
  }

  async currentAssigneeIds(taskId: string): Promise<string[]> {
    const rows = await this.prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })
    return rows.map((r) => r.userId)
  }
}
```

- [ ] **Step 5: Run test + check-types, commit**

Run: `pnpm --filter engines test -- kanban-gateway && pnpm --filter engines check-types`
Expected: PASS (engines now resolves `@repo/domain` — NodeNext-clean, no toolchain errors). 
```bash
git add apps/engines/package.json apps/engines/src/apps/mcp/services/kanban-gateway.service.ts apps/engines/src/apps/mcp/services/kanban-gateway.service.spec.ts pnpm-lock.yaml
git commit -m "feat(mcp): add KanbanGateway (resolvers, board guard, DomainError mapping)"
```

### Task 7: `KanbanReadService` (direct Prisma) + `KanbanWriteService` (→ `@repo/domain`)

**Files:**
- Create: `apps/engines/src/apps/mcp/services/kanban-read.service.ts` (+ `.spec.ts`)
- Create: `apps/engines/src/apps/mcp/services/kanban-write.service.ts` (+ `.spec.ts`)

- [ ] **Step 1: Write the failing read-service test**

`apps/engines/src/apps/mcp/services/kanban-read.service.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { KanbanGateway } from './kanban-gateway.service.js'
import { KanbanReadService } from './kanban-read.service.js'

describe('KanbanReadService', () => {
  const pageFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const taskFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    page: { findMany: pageFindMany, findFirst: jest.fn(async () => ({ id: 'b1' })) },
    sprint: { findFirst: jest.fn(async () => ({ id: 's-active' })), findMany: jest.fn(async () => []) },
    task: { findMany: taskFindMany },
    kanbanColumn: { findMany: jest.fn(async () => [{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }]) },
  } as unknown as PrismaClient
  let svc: KanbanReadService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new KanbanReadService(prisma, new KanbanGateway(prisma))
  })

  it('listBoards maps boards with active sprint', async () => {
    pageFindMany.mockResolvedValue([{ id: 'b1', title: 'Dev', icon: null, sprints: [{ id: 's1', name: 'S1' }] }])
    const out = await svc.listBoards('u1', 'w1')
    expect(out.boards).toEqual([{ boardPageId: 'b1', title: 'Dev', icon: null, activeSprint: { id: 's1', name: 'S1' } }])
  })

  it('listTasks maps tasks and resolves assignee "me"', async () => {
    pageFindMany.mockResolvedValue([{ id: 'b1', title: 'Dev' }])
    taskFindMany.mockResolvedValue([
      { id: 't1', title: 'Ship', dueDate: null, startDate: null, archived: false, column: { title: 'Todo', kind: 'ACTIVE' }, sprint: { id: 's1', name: 'S1' }, type: { title: 'Задача' }, priority: { title: 'High' }, assignees: [{ user: { id: 'u2', firstName: 'Ann', lastName: 'Lee' } }] },
    ])
    const out = await svc.listTasks('u1', 'w1', undefined, { assignee: 'me' })
    expect(out.tasks[0]).toMatchObject({ id: 't1', status: 'Todo', sprint: 'S1', assignees: [{ userId: 'u2', name: 'Ann Lee' }] })
    const where = (taskFindMany.mock.calls[0]![0] as { where: { assignees?: { some: { userId: string } } } }).where
    expect(where.assignees?.some.userId).toBe('u1')
  })
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter engines test -- kanban-read.service`.

- [ ] **Step 3: Implement `kanban-read.service.ts`**

```ts
import { HttpException, Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { KanbanGateway } from './kanban-gateway.service.js'

export type TaskFilters = { sprint?: string; assignee?: string; status?: string; includeArchived?: boolean }

const TASK_SELECT = {
  id: true, title: true, dueDate: true, startDate: true, archived: true,
  column: { select: { title: true, kind: true } },
  sprint: { select: { id: true, name: true } },
  type: { select: { title: true } },
  priority: { select: { title: true } },
  assignees: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
} as const

type TaskRow = {
  id: string; title: string; dueDate: Date | null; startDate: Date | null; archived: boolean
  column: { title: string; kind: string }
  sprint: { id: string; name: string } | null
  type: { title: string } | null
  priority: { title: string } | null
  assignees: { user: { id: string; firstName: string | null; lastName: string | null } }[]
}

function mapTask(t: TaskRow) {
  return {
    id: t.id, title: t.title, status: t.column.title, statusKind: t.column.kind,
    sprint: t.sprint?.name ?? null, priority: t.priority?.title ?? null, type: t.type?.title ?? null,
    dueDate: t.dueDate, startDate: t.startDate, archived: t.archived,
    assignees: t.assignees.map((a) => ({ userId: a.user.id, name: [a.user.firstName, a.user.lastName].filter(Boolean).join(' ') })),
  }
}

@Injectable()
export class KanbanReadService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient, private readonly gateway: KanbanGateway) {}

  async listBoards(userId: string, workspaceId: string) {
    const rows = await this.prisma.page.findMany({
      where: { workspaceId, type: 'KANBAN', deletedAt: null, archived: false, workspace: { members: { some: { userId } } } },
      select: { id: true, title: true, icon: true, sprints: { where: { status: 'ACTIVE' }, select: { id: true, name: true }, take: 1 } },
      orderBy: { createdAt: 'asc' }, take: 100,
    })
    return { boards: rows.map((b) => ({ boardPageId: b.id, title: b.title ?? '', icon: b.icon, activeSprint: b.sprints[0] ?? null })) }
  }

  async listSprints(userId: string, workspaceId: string, boardPageId?: string | null) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const sprints = await this.prisma.sprint.findMany({ where: { pageId: board }, orderBy: { position: 'asc' }, select: { id: true, name: true, status: true, startDate: true, endDate: true } })
    return { boardPageId: board, sprints }
  }

  async getActiveSprint(userId: string, workspaceId: string, boardPageId?: string | null) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const activeSprint = await this.prisma.sprint.findFirst({ where: { pageId: board, status: 'ACTIVE' }, select: { id: true, name: true, status: true, startDate: true, endDate: true } })
    return { boardPageId: board, activeSprint }
  }

  async listTasks(userId: string, workspaceId: string, boardPageId: string | null | undefined, filters: TaskFilters) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const sprintFilter = filters.sprint !== undefined ? { sprintId: await this.gateway.resolveSprintTarget(board, filters.sprint) } : {}
    const statusFilter = filters.status !== undefined ? { columnId: await this.gateway.resolveColumnByStatus(board, filters.status) } : {}
    const assigneeFilter = filters.assignee !== undefined ? { assignees: { some: { userId: this.gateway.resolveAssignee(userId, filters.assignee) } } } : {}
    const tasks = (await this.prisma.task.findMany({
      where: { pageId: board, deletedAt: null, ...(filters.includeArchived ? {} : { archived: false }), ...sprintFilter, ...statusFilter, ...assigneeFilter },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }], take: 200, select: TASK_SELECT,
    })) as TaskRow[]
    return { boardPageId: board, tasks: tasks.map(mapTask) }
  }

  async getTask(userId: string, workspaceId: string, boardPageId: string | null | undefined, taskId: string) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const task = (await this.prisma.task.findFirst({ where: { id: taskId, pageId: board }, select: TASK_SELECT })) as TaskRow | null
    if (!task) throw new HttpException({ code: 'TASK_NOT_FOUND', message: `task ${taskId} not found on board` }, 404)
    const activity = await this.prisma.taskActivity.findMany({
      where: { taskId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { type: true, createdAt: true, actor: { select: { id: true, firstName: true, lastName: true } } },
    })
    return {
      boardPageId: board, task: mapTask(task),
      activity: activity.map((a) => ({ type: a.type, createdAt: a.createdAt, actor: a.actor ? { userId: a.actor.id, name: [a.actor.firstName, a.actor.lastName].filter(Boolean).join(' ') } : null })),
    }
  }
}
```

- [ ] **Step 4: Write the failing write-service test**

`apps/engines/src/apps/mcp/services/kanban-write.service.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'

import type { MarkdownParser } from './markdown-parser.service.js'
import type { KanbanGateway } from './kanban-gateway.service.js'
import { KanbanWriteService } from './kanban-write.service.js'

// Mock @repo/domain so we assert the write service maps args and calls the right domain fn.
jest.unstable_mockModule('@repo/domain', () => ({
  createTask: jest.fn(async () => ({ id: 't1' })),
  updateTask: jest.fn(async () => ({ id: 't1' })),
  moveTask: jest.fn(async () => ({ id: 't1' })),
  setTaskAssignees: jest.fn(async () => ({ ok: true })),
  archiveTask: jest.fn(async () => ({ ok: true })),
  createSprint: jest.fn(async () => ({ id: 's1' })),
  activateSprint: jest.fn(async () => ({ ok: true })),
  completeSprint: jest.fn(async () => ({ ok: true })),
  createTaskComment: jest.fn(async () => ({ id: 'cm1' })),
}))
const domain = await import('@repo/domain')
const { KanbanWriteService: Svc } = await import('./kanban-write.service.js')

function makeGateway() {
  return {
    db: {},
    resolveBoardPageId: jest.fn(async (_u: string, _w: string, b?: string | null) => b ?? 'b1'),
    resolveColumnByStatus: jest.fn(async () => 'col-done'),
    findCancelColumn: jest.fn(async () => null),
    resolveSprintTarget: jest.fn(async () => 's-next'),
    resolveTypeByName: jest.fn(async () => 'ty1'),
    resolvePriorityByName: jest.fn(async () => 'pr1'),
    resolveAssignee: jest.fn((uid: string, v: string) => (v === 'me' ? uid : v)),
    currentAssigneeIds: jest.fn(async () => ['u2']),
    run: jest.fn((fn: () => unknown) => fn()),
  } as unknown as KanbanGateway
}

describe('KanbanWriteService', () => {
  const parser = { parse: jest.fn((md: string) => ({ type: 'doc', content: [{ type: 'text', text: md }] })) } as unknown as MarkdownParser
  let gw: KanbanGateway
  let svc: InstanceType<typeof Svc>

  beforeEach(() => {
    jest.clearAllMocks()
    gw = makeGateway()
    svc = new Svc(gw, parser)
  })

  it('moveTaskToStatus resolves column and calls domain.moveTask with null before/after', async () => {
    await svc.moveTaskToStatus('u1', 'w1', { boardPageId: 'b1', taskId: 't1', status: 'Done' })
    expect(domain.moveTask).toHaveBeenCalledWith({}, 'u1', { pageId: 'b1', id: 't1', targetColumnId: 'col-done', beforeId: null, afterId: null })
  })

  it('cancelTask archives when no CANCELLED column', async () => {
    const out = await svc.cancelTask('u1', 'w1', { boardPageId: 'b1', taskId: 't1' })
    expect(domain.archiveTask).toHaveBeenCalled()
    expect(out).toEqual({ ok: true, via: 'archive' })
  })

  it('assignTask merges with existing assignees', async () => {
    await svc.assignTask('u1', 'w1', { boardPageId: 'b1', taskId: 't1', user: 'me' })
    expect(domain.setTaskAssignees).toHaveBeenCalledWith({}, 'u1', { pageId: 'b1', id: 't1', userIds: ['u2', 'u1'] })
  })
})
```
(Uses `jest.unstable_mockModule` because engines Jest runs ESM. If the repo's existing specs use a different module-mock pattern, match it; otherwise this is the standard ESM approach.)

- [ ] **Step 5: Implement `kanban-write.service.ts`**

```ts
import { Injectable } from '@nestjs/common'
import * as domain from '@repo/domain'

import { KanbanGateway } from './kanban-gateway.service.js'
import { MarkdownParser } from './markdown-parser.service.js'

type Board = { boardPageId?: string | null }

@Injectable()
export class KanbanWriteService {
  constructor(
    private readonly gateway: KanbanGateway,
    private readonly parser: MarkdownParser,
  ) {}

  private get prisma() {
    return this.gateway.db
  }

  async createTask(userId: string, ws: string, a: Board & { title: string; status?: string; type?: string; priority?: string; sprint?: string; assignees?: string[]; dueDate?: Date }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const columnId = a.status ? await this.gateway.resolveColumnByStatus(board, a.status) : undefined
    const typeId = a.type ? await this.gateway.resolveTypeByName(board, a.type) : undefined
    const priorityId = a.priority ? await this.gateway.resolvePriorityByName(board, a.priority) : undefined
    const sprintId = a.sprint ? ((await this.gateway.resolveSprintTarget(board, a.sprint)) ?? undefined) : undefined
    const task = await this.gateway.run(() => domain.createTask(this.prisma, userId, { pageId: board, title: a.title, columnId, typeId, priorityId, sprintId }))
    if (a.assignees?.length) {
      const userIds = [...new Set(a.assignees.map((x) => this.gateway.resolveAssignee(userId, x)))]
      await this.gateway.run(() => domain.setTaskAssignees(this.prisma, userId, { pageId: board, id: task.id, userIds }))
    }
    if (a.dueDate) await this.gateway.run(() => domain.updateTask(this.prisma, userId, { pageId: board, id: task.id, dueDate: a.dueDate }))
    return { taskId: task.id }
  }

  async moveTaskToStatus(userId: string, ws: string, a: Board & { taskId: string; status: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const targetColumnId = await this.gateway.resolveColumnByStatus(board, a.status)
    await this.gateway.run(() => domain.moveTask(this.prisma, userId, { pageId: board, id: a.taskId, targetColumnId, beforeId: null, afterId: null }))
    return { ok: true as const }
  }

  async assignTask(userId: string, ws: string, a: Board & { taskId: string; user: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const target = this.gateway.resolveAssignee(userId, a.user)
    const userIds = [...new Set([...(await this.gateway.currentAssigneeIds(a.taskId)), target])]
    await this.gateway.run(() => domain.setTaskAssignees(this.prisma, userId, { pageId: board, id: a.taskId, userIds }))
    return { ok: true as const }
  }

  async unassignTask(userId: string, ws: string, a: Board & { taskId: string; user: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const target = this.gateway.resolveAssignee(userId, a.user)
    const userIds = (await this.gateway.currentAssigneeIds(a.taskId)).filter((id) => id !== target)
    await this.gateway.run(() => domain.setTaskAssignees(this.prisma, userId, { pageId: board, id: a.taskId, userIds }))
    return { ok: true as const }
  }

  async setTaskDates(userId: string, ws: string, a: Board & { taskId: string; startDate?: Date; dueDate?: Date }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    await this.gateway.run(() => domain.updateTask(this.prisma, userId, { pageId: board, id: a.taskId, startDate: a.startDate, dueDate: a.dueDate }))
    return { ok: true as const }
  }

  async setTaskSprint(userId: string, ws: string, a: Board & { taskId: string; target: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const sprintId = await this.gateway.resolveSprintTarget(board, a.target)
    await this.gateway.run(() => domain.updateTask(this.prisma, userId, { pageId: board, id: a.taskId, sprintId }))
    return { ok: true as const }
  }

  async setTaskPriority(userId: string, ws: string, a: Board & { taskId: string; value: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const priorityId = await this.gateway.resolvePriorityByName(board, a.value)
    await this.gateway.run(() => domain.updateTask(this.prisma, userId, { pageId: board, id: a.taskId, priorityId }))
    return { ok: true as const }
  }

  async setTaskType(userId: string, ws: string, a: Board & { taskId: string; value: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const typeId = await this.gateway.resolveTypeByName(board, a.value)
    await this.gateway.run(() => domain.updateTask(this.prisma, userId, { pageId: board, id: a.taskId, typeId }))
    return { ok: true as const }
  }

  async cancelTask(userId: string, ws: string, a: Board & { taskId: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const cancelColumnId = await this.gateway.findCancelColumn(board)
    if (cancelColumnId) {
      await this.gateway.run(() => domain.moveTask(this.prisma, userId, { pageId: board, id: a.taskId, targetColumnId: cancelColumnId, beforeId: null, afterId: null }))
      return { ok: true as const, via: 'column' as const }
    }
    await this.gateway.run(() => domain.archiveTask(this.prisma, userId, { pageId: board, id: a.taskId }))
    return { ok: true as const, via: 'archive' as const }
  }

  async addTaskComment(userId: string, ws: string, a: Board & { taskId: string; markdown: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const content = this.parser.parse(a.markdown)
    const comment = await this.gateway.run(() => domain.createTaskComment(this.prisma, userId, { pageId: board, taskId: a.taskId, content }))
    return { commentId: comment.id }
  }

  async createSprint(userId: string, ws: string, a: Board & { name: string; description?: string; startDate?: Date; endDate?: Date }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const sprint = await this.gateway.run(() => domain.createSprint(this.prisma, userId, { pageId: board, name: a.name, description: a.description, startDate: a.startDate, endDate: a.endDate }))
    return { sprintId: sprint.id }
  }

  async startSprint(userId: string, ws: string, a: Board & { sprintId: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    await this.gateway.run(() => domain.activateSprint(this.prisma, userId, { pageId: board, id: a.sprintId }))
    return { ok: true as const }
  }

  async closeSprint(userId: string, ws: string, a: Board & { sprintId: string; moveUndoneTo?: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const moveUndoneTo = a.moveUndoneTo !== undefined ? await this.gateway.resolveSprintTarget(board, a.moveUndoneTo) : null
    await this.gateway.run(() => domain.completeSprint(this.prisma, userId, { pageId: board, id: a.sprintId, moveUndoneTo }))
    return { ok: true as const }
  }
}
```

- [ ] **Step 6: Run tests + check-types, commit**

Run: `pnpm --filter engines test -- kanban-read.service kanban-write.service && pnpm --filter engines check-types`
Expected: PASS.
```bash
git add apps/engines/src/apps/mcp/services/kanban-read.service.ts apps/engines/src/apps/mcp/services/kanban-read.service.spec.ts apps/engines/src/apps/mcp/services/kanban-write.service.ts apps/engines/src/apps/mcp/services/kanban-write.service.spec.ts
git commit -m "feat(mcp): add Kanban read service (prisma) + write service (@repo/domain)"
```

### Task 8: `KanbanTools` (~18 tools) + module wiring + registry

**Files:**
- Create: `apps/engines/src/apps/mcp/tools/kanban.tools.ts` (+ `.spec.ts`)
- Modify: `apps/engines/src/apps/mcp/mcp.module.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing test**

`apps/engines/src/apps/mcp/tools/kanban.tools.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { KanbanReadService } from '../services/kanban-read.service.js'
import type { KanbanWriteService } from '../services/kanban-write.service.js'
import { KanbanTools } from './kanban.tools.js'

describe('KanbanTools', () => {
  const listBoards = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const moveTaskToStatus = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reads = { listBoards, listSprints: jest.fn(), getActiveSprint: jest.fn(), listTasks: jest.fn(), getTask: jest.fn() } as unknown as KanbanReadService
  const writes = { createTask: jest.fn(), moveTaskToStatus, assignTask: jest.fn(), unassignTask: jest.fn(), setTaskDates: jest.fn(), setTaskSprint: jest.fn(), setTaskPriority: jest.fn(), setTaskType: jest.fn(), cancelTask: jest.fn(), addTaskComment: jest.fn(), createSprint: jest.fn(), startSprint: jest.fn(), closeSprint: jest.fn() } as unknown as KanbanWriteService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: KanbanTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new KanbanTools(reads, writes)
  })

  it('listKanbanBoards delegates with caller id', async () => {
    listBoards.mockResolvedValue({ boards: [] })
    expect(await tools.listKanbanBoards({ workspaceId: 'w1' }, {} as never, req)).toEqual({ boards: [] })
    expect(listBoards).toHaveBeenCalledWith('u1', 'w1')
  })

  it('moveTaskToStatus delegates to the write service', async () => {
    moveTaskToStatus.mockResolvedValue({ ok: true })
    await tools.moveTaskToStatus({ workspaceId: 'w1', boardPageId: 'b1', taskId: 't1', status: 'Done' }, {} as never, req)
    expect(moveTaskToStatus).toHaveBeenCalledWith('u1', 'w1', { boardPageId: 'b1', taskId: 't1', status: 'Done' })
  })

  it('throws Unauthorized without auth', async () => {
    await expect(tools.listKanbanBoards({ workspaceId: 'w1' }, {} as never, { headers: {} } as AuthedRequest)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter engines test -- kanban.tools`.

- [ ] **Step 3: Implement `kanban.tools.ts`** — thin `@Tool` methods delegating to the services (the input schemas + descriptions are exactly as in the spec's tool inventory).

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import { z } from 'zod'

import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { KanbanReadService } from '../services/kanban-read.service.js'
import { KanbanWriteService } from '../services/kanban-write.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

const WorkspaceOnly = z.object({ workspaceId: z.string().uuid() })
const BoardScoped = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional() })
const ListTasks = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), sprint: mcpInput(z.string().max(120).optional()), assignee: mcpInput(z.string().max(64).optional()), status: mcpInput(z.string().max(120).optional()), includeArchived: mcpInput(z.boolean().optional()) })
const TaskRef = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), taskId: mcpUuid() })
const CreateTask = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), title: z.string().min(1).max(500), status: mcpInput(z.string().max(120).optional()), type: mcpInput(z.string().max(120).optional()), priority: mcpInput(z.string().max(120).optional()), sprint: mcpInput(z.string().max(120).optional()), assignees: mcpInput(z.array(z.string().min(1)).optional()), dueDate: mcpInput(z.coerce.date().optional()) })
const MoveTask = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), taskId: mcpUuid(), status: z.string().min(1).max(120) })
const Assign = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), taskId: mcpUuid(), user: z.string().min(1).max(64) })
const SetDates = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), taskId: mcpUuid(), startDate: mcpInput(z.coerce.date().optional()), dueDate: mcpInput(z.coerce.date().optional()) })
const SetSprint = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), taskId: mcpUuid(), target: z.string().min(1).max(120) })
const SetField = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), taskId: mcpUuid(), value: z.string().min(1).max(120) })
const AddComment = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), taskId: mcpUuid(), markdown: z.string().min(1).max(20_000) })
const CreateSprint = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), name: z.string().min(1).max(120), description: mcpInput(z.string().max(2000).optional()), startDate: mcpInput(z.coerce.date().optional()), endDate: mcpInput(z.coerce.date().optional()) })
const SprintRef = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), sprintId: mcpUuid() })
const CloseSprint = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), sprintId: mcpUuid(), moveUndoneTo: mcpInput(z.string().max(120).optional()) })

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class KanbanTools {
  constructor(private readonly reads: KanbanReadService, private readonly writes: KanbanWriteService) {}

  @Tool({ name: 'listKanbanBoards', description: 'Список Kanban-досок воркспейса (+активный спринт). Если доска одна — другие тулы можно звать без boardPageId. Параметр: workspaceId.', parameters: WorkspaceOnly })
  listKanbanBoards(a: z.infer<typeof WorkspaceOnly>, _c: Context, req: AuthedRequest) { return this.reads.listBoards(requireAuth(req).userId, a.workspaceId) }

  @Tool({ name: 'listSprints', description: 'Спринты доски (id, name, status, даты). «какие у нас спринты». Параметры: workspaceId, boardPageId (опц.).', parameters: BoardScoped })
  listSprints(a: z.infer<typeof BoardScoped>, _c: Context, req: AuthedRequest) { return this.reads.listSprints(requireAuth(req).userId, a.workspaceId, a.boardPageId) }

  @Tool({ name: 'getActiveSprint', description: 'Активный спринт доски (или null). «какой активный спринт». Параметры: workspaceId, boardPageId (опц.).', parameters: BoardScoped })
  getActiveSprint(a: z.infer<typeof BoardScoped>, _c: Context, req: AuthedRequest) { return this.reads.getActiveSprint(requireAuth(req).userId, a.workspaceId, a.boardPageId) }

  @Tool({ name: 'listTasks', description: 'Задачи доски. sprint:"current"|"backlog"|id|имя; assignee:"me"|userId; status:название колонки. «задачи в спринте/текущем/у меня/у {человека}». Параметры: workspaceId, boardPageId?, sprint?, assignee?, status?, includeArchived?.', parameters: ListTasks })
  listTasks(a: z.infer<typeof ListTasks>, _c: Context, req: AuthedRequest) { return this.reads.listTasks(requireAuth(req).userId, a.workspaceId, a.boardPageId, { sprint: a.sprint, assignee: a.assignee, status: a.status, includeArchived: a.includeArchived }) }

  @Tool({ name: 'getTask', description: 'Детали задачи + последние события. Параметры: workspaceId, boardPageId?, taskId.', parameters: TaskRef })
  getTask(a: z.infer<typeof TaskRef>, _c: Context, req: AuthedRequest) { return this.reads.getTask(requireAuth(req).userId, a.workspaceId, a.boardPageId, a.taskId) }

  @Tool({ name: 'createTask', description: 'Создаёт задачу. status=колонка; sprint="current"|"next"|"backlog"|id|имя; assignees=["me"|userId]; type/priority=название. Требует подтверждения. Параметры: workspaceId, boardPageId?, title, status?, type?, priority?, sprint?, assignees?, dueDate?.', parameters: CreateTask })
  createTask(a: z.infer<typeof CreateTask>, _c: Context, req: AuthedRequest) { return this.writes.createTask(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, title: a.title, status: a.status, type: a.type, priority: a.priority, sprint: a.sprint, assignees: a.assignees, dueDate: a.dueDate }) }

  @Tool({ name: 'moveTaskToStatus', description: 'Перемещает задачу в колонку-статус по названию. Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, status.', parameters: MoveTask })
  moveTaskToStatus(a: z.infer<typeof MoveTask>, _c: Context, req: AuthedRequest) { return this.writes.moveTaskToStatus(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId, status: a.status }) }

  @Tool({ name: 'assignTask', description: 'Назначает участника ("me"|userId). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, user.', parameters: Assign })
  assignTask(a: z.infer<typeof Assign>, _c: Context, req: AuthedRequest) { return this.writes.assignTask(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId, user: a.user }) }

  @Tool({ name: 'unassignTask', description: 'Снимает участника ("me"|userId). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, user.', parameters: Assign })
  unassignTask(a: z.infer<typeof Assign>, _c: Context, req: AuthedRequest) { return this.writes.unassignTask(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId, user: a.user }) }

  @Tool({ name: 'setTaskDates', description: 'Срок задачи: startDate и/или dueDate (ISO). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, startDate?, dueDate?.', parameters: SetDates })
  setTaskDates(a: z.infer<typeof SetDates>, _c: Context, req: AuthedRequest) { return this.writes.setTaskDates(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId, startDate: a.startDate, dueDate: a.dueDate }) }

  @Tool({ name: 'setTaskSprint', description: 'Спринт задачи: target="current"|"next"|"backlog"|id|имя. Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, target.', parameters: SetSprint })
  setTaskSprint(a: z.infer<typeof SetSprint>, _c: Context, req: AuthedRequest) { return this.writes.setTaskSprint(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId, target: a.target }) }

  @Tool({ name: 'setTaskPriority', description: 'Приоритет задачи (название). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, value.', parameters: SetField })
  setTaskPriority(a: z.infer<typeof SetField>, _c: Context, req: AuthedRequest) { return this.writes.setTaskPriority(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId, value: a.value }) }

  @Tool({ name: 'setTaskType', description: 'Тип задачи (название). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, value.', parameters: SetField })
  setTaskType(a: z.infer<typeof SetField>, _c: Context, req: AuthedRequest) { return this.writes.setTaskType(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId, value: a.value }) }

  @Tool({ name: 'cancelTask', description: 'Отменяет задачу: в колонку-CANCELLED, если есть, иначе archive. Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId.', parameters: TaskRef })
  cancelTask(a: z.infer<typeof TaskRef>, _c: Context, req: AuthedRequest) { return this.writes.cancelTask(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId }) }

  @Tool({ name: 'addTaskComment', description: 'Комментарий к задаче (Markdown). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, markdown.', parameters: AddComment })
  addTaskComment(a: z.infer<typeof AddComment>, _c: Context, req: AuthedRequest) { return this.writes.addTaskComment(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, taskId: a.taskId, markdown: a.markdown }) }

  @Tool({ name: 'createSprint', description: 'Создаёт спринт (PLANNED). Только владелец/создатель доски. Требует подтверждения. Параметры: workspaceId, boardPageId?, name, description?, startDate?, endDate?.', parameters: CreateSprint })
  createSprint(a: z.infer<typeof CreateSprint>, _c: Context, req: AuthedRequest) { return this.writes.createSprint(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, name: a.name, description: a.description, startDate: a.startDate, endDate: a.endDate }) }

  @Tool({ name: 'startSprint', description: 'Запускает спринт (активный; прочие→PLANNED). Только владелец/создатель. Требует подтверждения. Параметры: workspaceId, boardPageId?, sprintId.', parameters: SprintRef })
  startSprint(a: z.infer<typeof SprintRef>, _c: Context, req: AuthedRequest) { return this.writes.startSprint(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, sprintId: a.sprintId }) }

  @Tool({ name: 'closeSprint', description: 'Завершает спринт; незавершённые → moveUndoneTo ("next"|"backlog"|id|имя; по умолч. беклог). Только владелец/создатель. Требует подтверждения. Параметры: workspaceId, boardPageId?, sprintId, moveUndoneTo?.', parameters: CloseSprint })
  closeSprint(a: z.infer<typeof CloseSprint>, _c: Context, req: AuthedRequest) { return this.writes.closeSprint(requireAuth(req).userId, a.workspaceId, { boardPageId: a.boardPageId, sprintId: a.sprintId, moveUndoneTo: a.moveUndoneTo }) }
}
```

- [ ] **Step 4: Wire `mcp.module.ts`** — import `KanbanGateway`, `KanbanReadService`, `KanbanWriteService`, `KanbanTools`; add all four to `providers`; add `KanbanTools` to `exports`.

- [ ] **Step 5: Registry entries in agents** — In `tool_registry.py`, add scope constants `SCOPE_KANBAN_READ = 'kanban:read'`, `SCOPE_KANBAN_WRITE = 'kanban:write'`; add `DEFAULT_ENGINES_TOOLS` entries: the 5 reads (`listKanbanBoards`/`listSprints`/`getActiveSprint`/`listTasks`/`getTask`) → `SCOPE_KANBAN_READ`, `False`, `_summary_generic(...)`; the 13 writes (`createTask`/`moveTaskToStatus`/`assignTask`/`unassignTask`/`setTaskDates`/`setTaskSprint`/`setTaskPriority`/`setTaskType`/`cancelTask`/`addTaskComment`/`createSprint`/`startSprint`/`closeSprint`) → `SCOPE_KANBAN_WRITE`, `True`, with a `lambda a: f'…{a.get("taskId") or a.get("sprintId") or a.get("title")}'` summary each.

- [ ] **Step 6: Run tests + check-types, commit**

Run: `pnpm --filter engines test -- kanban && pnpm --filter engines check-types && pnpm --filter engines lint`
Expected: PASS, lint clean.
```bash
git add apps/engines/src/apps/mcp/tools/kanban.tools.ts apps/engines/src/apps/mcp/tools/kanban.tools.spec.ts apps/engines/src/apps/mcp/mcp.module.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add Kanban MCP tools (reads + writes) + wiring + registry"
```

### Task 9: Integration test + scope drift-guard + gates + spec status

**Files:**
- Create: `apps/engines/test/integration/kanban-domain.int-spec.ts` (match the `test-int` config's location/glob)
- Modify: `apps/web/test/agents-token.test.ts`
- Modify: `docs/superpowers/specs/2026-05-29-domain-foundation-and-kanban-design.md`

- [ ] **Step 1: Integration test (engines write service → `@repo/domain` → DB)** — confirm `cat apps/engines/jest.integration.config.ts` for the glob; create a test that seeds a user/workspace/KANBAN page + two columns, then exercises `KanbanWriteService.createTask` + `moveTaskToStatus` and asserts the task's `columnId` changed and `TaskActivity` has `CREATED`/`MOVED`/`STATUS_CHANGED`. Build the service with a real `KanbanGateway(prisma)` + a stub `MarkdownParser`. Requires `docker compose up -d`. (If the int harness seeds users specially, mirror an existing `*.int-spec.ts`.)

- [ ] **Step 2:** `docker compose up -d && pnpm --filter engines test-int -- kanban-domain` → PASS.

- [ ] **Step 3: Drift-guard** — add `'kanban:read'` to `REQUIRED_READ` and `'kanban:write'` to `REQUIRED_WRITE` in `apps/web/test/agents-token.test.ts` (scopes already granted in `agents-token.ts`). Run `pnpm --filter web test -- agents-token` → PASS.

- [ ] **Step 4: Full gates** — `pnpm gates` (with `.env` sourced; `@repo/domain` builds first via turbo `^build`). If `web#check-types` trips a stale `.next/types`, `rm -rf apps/web/.next/types` and re-run.

- [ ] **Step 5: Mark spec implemented + commit** — set `**Status:** Implemented` in the spec.
```bash
git add apps/engines/test/integration/kanban-domain.int-spec.ts apps/web/test/agents-token.test.ts docs/superpowers/specs/2026-05-29-domain-foundation-and-kanban-design.md
git commit -m "test(domain): kanban engines→domain integration + scope drift-guard; mark spec implemented"
```

---

## Self-Review

**Spec coverage:** `@repo/domain` package (Task 1); kanban helpers/access (Task 2), task writes (Task 3), sprint+comment writes (Task 4) — single source of truth ✔. tRPC thin wrappers + `mapDomain` + helper re-export (Task 5) ✔. engines gateway/resolvers + DomainError mapping (Task 6); read+write services (Task 7); ~18 tools + registry (Task 8) ✔. Integration + drift-guard + gates (Task 9) ✔. Item-8 cases + UC3 covered by the tool set; integration proves the engines→domain path.

**Type/name consistency:** domain fn names (`createTask`/`updateTask`/`moveTask`/`setTaskAssignees`/`archiveTask`/`createSprint`/`activateSprint`/`completeSprint`/`createTaskComment`) + zod schema names (`createTaskInput`…) are used identically in tRPC wrappers (Task 5), the write service (Task 7), and the domain barrel (Task 4). Gateway method names match between Task 6 (defs) and Task 7 (uses). `move` always passes `beforeId:null, afterId:null`; `completeSprint` always passes `moveUndoneTo`. `import * as domain` avoids the engines write-service method-name clash.

**Placeholder scan:** none — full code in every step; Task 5 lists each migrated procedure's exact new body; Task 8 lists all ~18 tools; Task 9 enumerates the registry entries explicitly.

**Deviations from spec:** none material. Reads are direct Prisma (per spec). The domain index is flat-exported (not namespaced) for clean NodeNext+Bundler resolution — a refinement, noted.

## Notes for the executor

- **Critical:** `@repo/domain` must be **built** (`pnpm --filter @repo/domain build`) before `@repo/trpc`/engines `check-types` in CI/gates — turbo's `^build` handles this because both declare `@repo/domain` as a dependency. Locally, run the domain build once after Task 1.
- The **regression guard** for Task 5 is the existing `@repo/trpc` kanban test suite + the board UI — keep them green; the domain ports are verbatim so messages/behavior match.
- Authz lives in the domain; engines adds the board-in-workspace guard. `kanban:read`/`kanban:write` are already granted in `agents-token.ts`.
- Realtime: engines writes don't emit to the web `kanbanBus` (separate process) — accepted, documented.
- Recommended task order: 1→2→3→4 (domain) → 5 (tRPC) → 6→7→8 (engines) → 9 (verify). Domain + tRPC can land before engines; each phase is independently green.



