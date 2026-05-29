# Kanban MCP Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~18 Kanban MCP tools to `apps/engines` that reuse the existing tRPC kanban procedures via a server-side `createCaller`, covering request item 8 + UC3.

**Architecture:** A new `@repo/trpc/helpers/kanban-caller` exposes a caller over a kanban-only router. A `KanbanGateway` (engines) builds a synthetic tRPC context `{ prisma, user:{id}, headers, resHeaders, yookassa:stub, returnUrlBase }` and invokes the kanban procedures through it — reusing their transactions, `TaskActivity` audit, fractional positions, single-active-sprint invariant, and authorization (`assertPageAccess`/`assertPageOwnership`). Reads are targeted Prisma queries; writes go through the caller. Thin `@Tool` methods delegate to the gateway + read/write services.

**Tech Stack:** NestJS + `@rekog/mcp-nest` + Zod (engines), tRPC v11 `createCallerFactory` (`@repo/trpc`), Prisma 7 (`@repo/db`), Jest (engines).

**Spec:** [docs/superpowers/specs/2026-05-29-kanban-mcp-tooling-design.md](docs/superpowers/specs/2026-05-29-kanban-mcp-tooling-design.md)

**Conventions (every engines task):**
- `.js` extensions on relative imports (NodeNext). Prettier: no semicolons, single quotes, 100-width.
- Tool method: `name(args, _context: Context, req: AuthedRequest)` → `requireAuth(req)` → delegate. `requireAuth`/`AuthedRequest`/`AuthContext` exactly as in [search.tools.ts](apps/engines/src/apps/mcp/tools/search.tools.ts).
- Tests next to source as `*.spec.ts`; run `pnpm --filter engines test -- <substring>`; type-check `pnpm --filter engines check-types`.
- After adding a tool class: register in `mcp.module.ts` (`providers` + `exports`); add `DEFAULT_ENGINES_TOOLS` entry in `apps/agents/.../tool_registry.py` (scope + confirmation).
- Commit per task; end the body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.

**Verified facts (from the tRPC routers):**
- `kanban.task.create({ pageId, columnId?, typeId?, priorityId?, sprintId?, title })` → returns the created `Task`.
- `kanban.task.move({ pageId, id, targetColumnId, beforeId, afterId })` — `beforeId`/`afterId` are **nullable & required**; pass `null` to append.
- `kanban.task.update({ pageId, id, title?, description?, startDate?, dueDate?, typeId?, priorityId?, sprintId?, sprintPosition?, parentId? })` — date fields accept `Date | ISO string | null`; `*Id` accept `null`.
- `kanban.task.setAssignees({ pageId, id, userIds })` — full list (diffs internally).
- `kanban.task.archive({ pageId, id })`.
- `kanban.sprint.create({ pageId, name, description?, startDate?, endDate? })`; `kanban.sprint.activate({ pageId, id })`; `kanban.sprint.complete({ pageId, id, moveUndoneTo })` (`moveUndoneTo` nullable & required).
- `kanban.comment.create({ pageId, taskId, content })` — `content` is Tiptap JSON.
- `kanban.board.getActivity({ pageId, taskId })`.
- Sprint procedures use `assertPageOwnership` (owner/creator); task/comment use `assertPageAccess` (any member). Procedures throw `TRPCError`.
- The procedures' `Ctx` only reads `ctx.prisma` + `ctx.user.id`.

---

## Task 1: `@repo/trpc/helpers/kanban-caller` (server-side kanban caller)

**Files:**
- Create: `packages/trpc/src/helpers/kanban-caller.ts`
- Test: `packages/trpc/test/kanban-caller.test.ts` (vitest; `pnpm --filter @repo/trpc test`)

- [ ] **Step 1: Write the failing test**

Create `packages/trpc/test/kanban-caller.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

import { createKanbanCaller } from '../src/helpers/kanban-caller'

describe('createKanbanCaller', () => {
  it('builds a caller exposing the kanban procedures without touching the DB', () => {
    const caller = createKanbanCaller({
      prisma: {} as never,
      user: { id: 'u1' } as never,
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: {} as never,
      returnUrlBase: '',
    })
    expect(typeof caller.kanban.task.create).toBe('function')
    expect(typeof caller.kanban.task.move).toBe('function')
    expect(typeof caller.kanban.sprint.activate).toBe('function')
    expect(typeof caller.kanban.comment.create).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/trpc test -- kanban-caller`
Expected: FAIL — cannot find module `../src/helpers/kanban-caller`.

- [ ] **Step 3: Implement the helper**

Create `packages/trpc/src/helpers/kanban-caller.ts`:

```ts
import { createCallerFactory, router } from '../trpc'
import { kanbanRouter } from '../routers/kanban'

// A caller over ONLY the kanban router — importing the full appRouter here would
// pull React/UI/editor packages into server consumers (apps/engines). Keeping the
// graph kanban-only keeps it server-safe.
export const kanbanOnlyRouter = router({ kanban: kanbanRouter })
export const createKanbanCaller = createCallerFactory(kanbanOnlyRouter)
export type KanbanCaller = ReturnType<typeof createKanbanCaller>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/trpc test -- kanban-caller && pnpm --filter @repo/trpc check-types`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/helpers/kanban-caller.ts packages/trpc/test/kanban-caller.test.ts
git commit -m "feat(trpc): add server-side createKanbanCaller (kanban-only router)"
```

---

## Task 2: `KanbanGateway` core (context, caller, error mapping, board guard)

**Files:**
- Create: `apps/engines/src/apps/mcp/services/kanban-gateway.service.ts`
- Test: `apps/engines/src/apps/mcp/services/kanban-gateway.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/services/kanban-gateway.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { HttpException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { KanbanGateway, mapTrpcError } from './kanban-gateway.service.js'

describe('mapTrpcError', () => {
  it('maps TRPCError codes to HttpException statuses', () => {
    const e = { name: 'TRPCError', code: 'FORBIDDEN', message: 'nope' }
    const mapped = mapTrpcError(e)
    expect(mapped).toBeInstanceOf(HttpException)
    expect((mapped as HttpException).getStatus()).toBe(403)
  })

  it('passes through non-TRPC errors unchanged', () => {
    const e = new Error('boom')
    expect(mapTrpcError(e)).toBe(e)
  })
})

describe('KanbanGateway.assertBoard', () => {
  const findFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { page: { findFirst } } as unknown as PrismaClient
  let gw: KanbanGateway

  beforeEach(() => {
    jest.clearAllMocks()
    gw = new KanbanGateway(prisma)
  })

  it('returns the board page when it is a KANBAN page in the workspace and the user is a member', async () => {
    findFirst.mockResolvedValue({ id: 'b1' })
    await expect(gw.assertBoard('u1', 'w1', 'b1')).resolves.toEqual({ id: 'b1' })
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'b1',
        type: 'KANBAN',
        workspaceId: 'w1',
        workspace: { members: { some: { userId: 'u1' } } },
      },
      select: { id: true },
    })
  })

  it('throws PageNotFoundError when the board is not a KANBAN page in this workspace', async () => {
    findFirst.mockResolvedValue(null)
    await expect(gw.assertBoard('u1', 'w1', 'b1')).rejects.toBeInstanceOf(PageNotFoundError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- kanban-gateway`
Expected: FAIL — cannot find module `./kanban-gateway.service.js`.

- [ ] **Step 3: Implement the gateway core**

Create `apps/engines/src/apps/mcp/services/kanban-gateway.service.ts`:

```ts
import { HttpException, Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import type { Context } from '@repo/trpc'
import { createKanbanCaller, type KanbanCaller } from '@repo/trpc/helpers/kanban-caller'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'

const TRPC_TO_HTTP: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
}

function isTrpcError(e: unknown): e is { code: string; message: string } {
  return (
    !!e &&
    typeof e === 'object' &&
    (e as { name?: string }).name === 'TRPCError' &&
    typeof (e as { code?: unknown }).code === 'string'
  )
}

/** Translate a tRPC error thrown by a reused kanban procedure into an MCP HttpException. */
export function mapTrpcError(e: unknown): unknown {
  if (!isTrpcError(e)) return e
  const status = TRPC_TO_HTTP[e.code] ?? 400
  return new HttpException({ code: `KANBAN_${e.code}`, message: e.message }, status)
}

// Kanban procedures never touch ctx.yookassa / ctx.returnUrlBase; a throwing stub documents that.
const YOOKASSA_STUB: Context['yookassa'] = {
  createPayment() {
    throw new Error('yookassa unavailable in engines kanban context')
  },
  getPayment() {
    throw new Error('yookassa unavailable in engines kanban context')
  },
}

@Injectable()
export class KanbanGateway {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** The kanban sub-caller bound to a synthetic, service-side context for `userId`. */
  caller(userId: string): KanbanCaller['kanban'] {
    const ctx: Context = {
      prisma: this.prisma,
      user: { id: userId } as Context['user'],
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: YOOKASSA_STUB,
      returnUrlBase: '',
    }
    return createKanbanCaller(ctx).kanban
  }

  /** Run a caller call, translating any TRPCError into an MCP HttpException. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw mapTrpcError(e)
    }
  }

  /** Verify the board is a KANBAN page in the injected workspace and the user is a member. */
  async assertBoard(userId: string, workspaceId: string, boardPageId: string): Promise<{ id: string }> {
    const page = await this.prisma.page.findFirst({
      where: {
        id: boardPageId,
        type: 'KANBAN',
        workspaceId,
        workspace: { members: { some: { userId } } },
      },
      select: { id: true },
    })
    if (!page) throw new PageNotFoundError(boardPageId)
    return page
  }

  get db(): PrismaClient {
    return this.prisma
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- kanban-gateway && pnpm --filter engines check-types`
Expected: PASS. (If `check-types` flags the `Context['yookassa']` stub shape, align the stub's method signatures to the `YookassaClientLike` interface in `packages/trpc/src/trpc.ts` — `createPayment(input, idempotencyKey)` / `getPayment(paymentId)`.)

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/kanban-gateway.service.ts apps/engines/src/apps/mcp/services/kanban-gateway.service.spec.ts
git commit -m "feat(mcp): add KanbanGateway core (caller context, TRPCError mapping, board guard)"
```

---

## Task 3: `KanbanGateway` resolvers (status → column, sprint target, cancel column, type/priority, assignee)

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/kanban-gateway.service.ts`
- Test: `apps/engines/src/apps/mcp/services/kanban-gateway-resolvers.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/services/kanban-gateway-resolvers.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { BadRequestException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { KanbanGateway } from './kanban-gateway.service.js'

describe('KanbanGateway resolvers', () => {
  const columnFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const sprintFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const sprintFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    kanbanColumn: { findMany: columnFindMany },
    sprint: { findFirst: sprintFindFirst, findMany: sprintFindMany },
  } as unknown as PrismaClient
  let gw: KanbanGateway

  beforeEach(() => {
    jest.clearAllMocks()
    gw = new KanbanGateway(prisma)
  })

  it('resolveColumnByStatus matches a column title case-insensitively', async () => {
    columnFindMany.mockResolvedValue([
      { id: 'c1', title: 'Todo', kind: 'ACTIVE' },
      { id: 'c2', title: 'In Progress', kind: 'ACTIVE' },
    ])
    expect(await gw.resolveColumnByStatus('b1', 'in progress')).toBe('c2')
  })

  it('resolveColumnByStatus throws with available names when no match', async () => {
    columnFindMany.mockResolvedValue([{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }])
    await expect(gw.resolveColumnByStatus('b1', 'Done')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('findCancelColumn returns a CANCELLED column id or null', async () => {
    columnFindMany.mockResolvedValueOnce([{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }, { id: 'c3', title: 'Cancelled', kind: 'CANCELLED' }])
    expect(await gw.findCancelColumn('b1')).toBe('c3')
    columnFindMany.mockResolvedValueOnce([{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }])
    expect(await gw.findCancelColumn('b1')).toBeNull()
  })

  it('resolveSprintTarget handles current/backlog/name', async () => {
    sprintFindFirst.mockResolvedValue({ id: 's-active' })
    expect(await gw.resolveSprintTarget('b1', 'current')).toBe('s-active')
    expect(await gw.resolveSprintTarget('b1', 'backlog')).toBeNull()
    sprintFindMany.mockResolvedValue([{ id: 's2', name: 'Sprint 2', status: 'PLANNED', position: 2 }])
    expect(await gw.resolveSprintTarget('b1', 'Sprint 2')).toBe('s2')
  })

  it('resolveAssignee maps "me" to the caller id, else passes the value through', () => {
    expect(gw.resolveAssignee('u1', 'me')).toBe('u1')
    expect(gw.resolveAssignee('u1', 'u2')).toBe('u2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- kanban-gateway-resolvers`
Expected: FAIL — resolver methods do not exist.

- [ ] **Step 3: Add the resolvers to `KanbanGateway`**

In `apps/engines/src/apps/mcp/services/kanban-gateway.service.ts`, add `BadRequestException` to the `@nestjs/common` import:
```ts
import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common'
```
Add these methods inside the `KanbanGateway` class:

```ts
  async resolveColumnByStatus(boardPageId: string, status: string): Promise<string> {
    const columns = await this.prisma.kanbanColumn.findMany({
      where: { pageId: boardPageId },
      select: { id: true, title: true, kind: true },
    })
    const want = status.trim().toLowerCase()
    const hit = columns.find((c) => c.title.trim().toLowerCase() === want)
    if (!hit) {
      const names = columns.map((c) => `"${c.title}"`).join(', ')
      throw new BadRequestException(`Unknown status "${status}". Available columns: ${names || '(none)'}`)
    }
    return hit.id
  }

  async findCancelColumn(boardPageId: string): Promise<string | null> {
    const columns = await this.prisma.kanbanColumn.findMany({
      where: { pageId: boardPageId },
      select: { id: true, kind: true },
    })
    return columns.find((c) => c.kind === 'CANCELLED')?.id ?? null
  }

  /**
   * Resolve a sprint target into a sprintId or null (backlog).
   * Accepts: 'current' (ACTIVE), 'next' (next PLANNED by position), 'backlog' (null),
   * a sprint name (case-insensitive), or a sprint id.
   */
  async resolveSprintTarget(boardPageId: string, target: string): Promise<string | null> {
    const t = target.trim()
    if (t.toLowerCase() === 'backlog') return null
    if (t.toLowerCase() === 'current') {
      const active = await this.prisma.sprint.findFirst({
        where: { pageId: boardPageId, status: 'ACTIVE' },
        select: { id: true },
      })
      if (!active) throw new BadRequestException('No active sprint on this board')
      return active.id
    }
    const sprints = await this.prisma.sprint.findMany({
      where: { pageId: boardPageId },
      select: { id: true, name: true, status: true, position: true },
      orderBy: { position: 'asc' },
    })
    if (t.toLowerCase() === 'next') {
      const active = sprints.find((s) => s.status === 'ACTIVE')
      const planned = sprints.filter((s) => s.status === 'PLANNED')
      const next = active
        ? planned.find((s) => s.position > active.position) ?? planned[0]
        : planned[0]
      if (!next) throw new BadRequestException('No next (planned) sprint on this board')
      return next.id
    }
    const byName = sprints.find((s) => s.name.trim().toLowerCase() === t.toLowerCase())
    if (byName) return byName.id
    const byId = sprints.find((s) => s.id === t)
    if (byId) return byId.id
    throw new BadRequestException(`Sprint not found: "${target}"`)
  }

  resolveAssignee(callerUserId: string, value: string): string {
    return value === 'me' ? callerUserId : value
  }

  async currentAssigneeIds(taskId: string): Promise<string[]> {
    const rows = await this.prisma.taskAssignee.findMany({
      where: { taskId },
      select: { userId: true },
    })
    return rows.map((r) => r.userId)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- kanban-gateway-resolvers && pnpm --filter engines check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/kanban-gateway.service.ts apps/engines/src/apps/mcp/services/kanban-gateway-resolvers.spec.ts
git commit -m "feat(mcp): add Kanban gateway resolvers (status/sprint/cancel/assignee)"
```

## Task 4: `resolveBoardPageId` + `KanbanReadService`

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/kanban-gateway.service.ts`
- Create: `apps/engines/src/apps/mcp/services/kanban-read.service.ts`
- Test: `apps/engines/src/apps/mcp/services/kanban-read.service.spec.ts`

- [ ] **Step 1: Add `resolveBoardPageId` to the gateway**

In `kanban-gateway.service.ts`, add this method inside `KanbanGateway` (auto-selects the board when the workspace has exactly one KANBAN page; errors otherwise):

```ts
  async resolveBoardPageId(
    userId: string,
    workspaceId: string,
    boardPageId?: string | null,
  ): Promise<string> {
    if (boardPageId) {
      await this.assertBoard(userId, workspaceId, boardPageId)
      return boardPageId
    }
    const boards = await this.prisma.page.findMany({
      where: {
        workspaceId,
        type: 'KANBAN',
        deletedAt: null,
        archived: false,
        workspace: { members: { some: { userId } } },
      },
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
```

- [ ] **Step 2: Write the failing read-service test**

Create `apps/engines/src/apps/mcp/services/kanban-read.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { KanbanGateway } from './kanban-gateway.service.js'
import { KanbanReadService } from './kanban-read.service.js'

describe('KanbanReadService', () => {
  const pageFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const sprintFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const taskFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    page: { findMany: pageFindMany, findFirst: jest.fn(async () => ({ id: 'b1' })) },
    sprint: { findMany: sprintFindMany, findFirst: jest.fn(async () => ({ id: 's-active' })) },
    task: { findMany: taskFindMany },
    kanbanColumn: { findMany: jest.fn(async () => [{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }]) },
  } as unknown as PrismaClient
  let svc: KanbanReadService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new KanbanReadService(prisma, new KanbanGateway(prisma))
  })

  it('listBoards maps boards with their active sprint', async () => {
    pageFindMany.mockResolvedValue([
      { id: 'b1', title: 'Dev', icon: null, sprints: [{ id: 's1', name: 'Sprint 1' }] },
    ])
    const out = await svc.listBoards('u1', 'w1')
    expect(out.boards).toEqual([
      { boardPageId: 'b1', title: 'Dev', icon: null, activeSprint: { id: 's1', name: 'Sprint 1' } },
    ])
  })

  it('listTasks maps tasks and filters by resolved sprint/status', async () => {
    // board auto-resolve: one KANBAN page
    pageFindMany.mockResolvedValue([{ id: 'b1', title: 'Dev' }])
    taskFindMany.mockResolvedValue([
      {
        id: 't1', title: 'Ship', dueDate: null, startDate: null, archived: false,
        column: { title: 'Todo', kind: 'ACTIVE' }, sprint: { id: 's1', name: 'Sprint 1' },
        type: { title: 'Задача' }, priority: { title: 'Высокий' },
        assignees: [{ user: { id: 'u2', firstName: 'Ann', lastName: 'Lee' } }],
      },
    ])
    const out = await svc.listTasks('u1', 'w1', undefined, { sprint: 'current', assignee: 'me' })
    expect(out.tasks[0]).toMatchObject({
      id: 't1', title: 'Ship', status: 'Todo', sprint: 'Sprint 1',
      priority: 'Высокий', type: 'Задача', assignees: [{ userId: 'u2', name: 'Ann Lee' }],
    })
    // assignee 'me' resolved to the caller id in the where clause
    const where = (taskFindMany.mock.calls[0]![0] as { where: { assignees?: { some: { userId: string } } } }).where
    expect(where.assignees?.some.userId).toBe('u1')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter engines test -- kanban-read.service`
Expected: FAIL — cannot find module `./kanban-read.service.js`.

- [ ] **Step 4: Implement `KanbanReadService`**

Create `apps/engines/src/apps/mcp/services/kanban-read.service.ts`:

```ts
import { HttpException, Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { KanbanGateway } from './kanban-gateway.service.js'

export type TaskFilters = {
  sprint?: string
  assignee?: string
  status?: string
  includeArchived?: boolean
}

const TASK_SELECT = {
  id: true,
  title: true,
  dueDate: true,
  startDate: true,
  archived: true,
  column: { select: { title: true, kind: true } },
  sprint: { select: { id: true, name: true } },
  type: { select: { title: true } },
  priority: { select: { title: true } },
  assignees: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
} as const

type TaskRow = {
  id: string
  title: string
  dueDate: Date | null
  startDate: Date | null
  archived: boolean
  column: { title: string; kind: string }
  sprint: { id: string; name: string } | null
  type: { title: string } | null
  priority: { title: string } | null
  assignees: { user: { id: string; firstName: string | null; lastName: string | null } }[]
}

function mapTask(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    status: t.column.title,
    statusKind: t.column.kind,
    sprint: t.sprint?.name ?? null,
    priority: t.priority?.title ?? null,
    type: t.type?.title ?? null,
    dueDate: t.dueDate,
    startDate: t.startDate,
    archived: t.archived,
    assignees: t.assignees.map((a) => ({
      userId: a.user.id,
      name: [a.user.firstName, a.user.lastName].filter(Boolean).join(' '),
    })),
  }
}

@Injectable()
export class KanbanReadService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly gateway: KanbanGateway,
  ) {}

  async listBoards(userId: string, workspaceId: string) {
    const rows = await this.prisma.page.findMany({
      where: {
        workspaceId,
        type: 'KANBAN',
        deletedAt: null,
        archived: false,
        workspace: { members: { some: { userId } } },
      },
      select: {
        id: true,
        title: true,
        icon: true,
        sprints: { where: { status: 'ACTIVE' }, select: { id: true, name: true }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    return {
      boards: rows.map((b) => ({
        boardPageId: b.id,
        title: b.title ?? '',
        icon: b.icon,
        activeSprint: b.sprints[0] ?? null,
      })),
    }
  }

  async listSprints(userId: string, workspaceId: string, boardPageId?: string | null) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const sprints = await this.prisma.sprint.findMany({
      where: { pageId: board },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    })
    return { boardPageId: board, sprints }
  }

  async getActiveSprint(userId: string, workspaceId: string, boardPageId?: string | null) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const activeSprint = await this.prisma.sprint.findFirst({
      where: { pageId: board, status: 'ACTIVE' },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    })
    return { boardPageId: board, activeSprint }
  }

  async listTasks(
    userId: string,
    workspaceId: string,
    boardPageId: string | null | undefined,
    filters: TaskFilters,
  ) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const sprintFilter =
      filters.sprint !== undefined
        ? { sprintId: await this.gateway.resolveSprintTarget(board, filters.sprint) }
        : {}
    const statusFilter =
      filters.status !== undefined
        ? { columnId: await this.gateway.resolveColumnByStatus(board, filters.status) }
        : {}
    const assigneeFilter =
      filters.assignee !== undefined
        ? { assignees: { some: { userId: this.gateway.resolveAssignee(userId, filters.assignee) } } }
        : {}
    const tasks = (await this.prisma.task.findMany({
      where: {
        pageId: board,
        deletedAt: null,
        ...(filters.includeArchived ? {} : { archived: false }),
        ...sprintFilter,
        ...statusFilter,
        ...assigneeFilter,
      },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
      take: 200,
      select: TASK_SELECT,
    })) as TaskRow[]
    return { boardPageId: board, tasks: tasks.map(mapTask) }
  }

  async getTask(userId: string, workspaceId: string, boardPageId: string | null | undefined, taskId: string) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const task = (await this.prisma.task.findFirst({
      where: { id: taskId, pageId: board },
      select: TASK_SELECT,
    })) as TaskRow | null
    if (!task) throw new HttpException({ code: 'TASK_NOT_FOUND', message: `task ${taskId} not found on board` }, 404)
    const activity = await this.prisma.taskActivity.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        type: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    return {
      boardPageId: board,
      task: mapTask(task),
      activity: activity.map((a) => ({
        type: a.type,
        createdAt: a.createdAt,
        actor: a.actor
          ? { userId: a.actor.id, name: [a.actor.firstName, a.actor.lastName].filter(Boolean).join(' ') }
          : null,
      })),
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter engines test -- kanban-read.service kanban-gateway && pnpm --filter engines check-types`
Expected: PASS. (If the `as const` `TASK_SELECT` causes a Prisma type mismatch, drop `as const` and let it infer, or type it `Prisma.TaskSelect`.)

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/mcp/services/kanban-gateway.service.ts apps/engines/src/apps/mcp/services/kanban-read.service.ts apps/engines/src/apps/mcp/services/kanban-read.service.spec.ts
git commit -m "feat(mcp): add Kanban board resolution + read service"
```

---

## Task 5: Kanban read tools + module wiring + registry

**Files:**
- Create: `apps/engines/src/apps/mcp/tools/kanban.tools.ts`
- Test: `apps/engines/src/apps/mcp/tools/kanban.tools.spec.ts`
- Modify: `apps/engines/src/apps/mcp/mcp.module.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/tools/kanban.tools.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { KanbanReadService } from '../services/kanban-read.service.js'
import type { KanbanWriteService } from '../services/kanban-write.service.js'
import { KanbanTools } from './kanban.tools.js'

describe('KanbanTools (reads)', () => {
  const listBoards = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const listTasks = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reads = { listBoards, listTasks, listSprints: jest.fn(), getActiveSprint: jest.fn(), getTask: jest.fn() } as unknown as KanbanReadService
  const writes = {} as unknown as KanbanWriteService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: KanbanTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new KanbanTools(reads, writes)
  })

  it('listKanbanBoards delegates with the caller id + workspace', async () => {
    listBoards.mockResolvedValue({ boards: [] })
    const out = await tools.listKanbanBoards({ workspaceId: 'w1' }, {} as never, req)
    expect(out).toEqual({ boards: [] })
    expect(listBoards).toHaveBeenCalledWith('u1', 'w1')
  })

  it('listTasks forwards filters', async () => {
    listTasks.mockResolvedValue({ boardPageId: 'b1', tasks: [] })
    await tools.listTasks({ workspaceId: 'w1', boardPageId: 'b1', sprint: 'current', assignee: 'me' }, {} as never, req)
    expect(listTasks).toHaveBeenCalledWith('u1', 'w1', 'b1', { sprint: 'current', assignee: 'me', status: undefined, includeArchived: undefined })
  })

  it('throws Unauthorized without auth', async () => {
    await expect(
      tools.listKanbanBoards({ workspaceId: 'w1' }, {} as never, { headers: {} } as AuthedRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- kanban.tools`
Expected: FAIL — cannot find module `./kanban.tools.js` (and `./kanban-write.service.js`, created in Task 6 — to unblock this task, the file is created in Task 6; if running Task 5 before Task 6, add a temporary empty `KanbanWriteService` stub or do Task 6 first. Recommended: implement Task 6's `kanban-write.service.ts` before this test compiles — see Task ordering note at the end.)

- [ ] **Step 3: Implement `KanbanTools` with the read tools**

Create `apps/engines/src/apps/mcp/tools/kanban.tools.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import { z } from 'zod'

import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { KanbanReadService } from '../services/kanban-read.service.js'
import { KanbanWriteService } from '../services/kanban-write.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

const WorkspaceOnlyInput = z.object({ workspaceId: z.string().uuid() })
const BoardScopedInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
})
const ListTasksInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  sprint: mcpInput(z.string().max(120).optional()),
  assignee: mcpInput(z.string().max(64).optional()),
  status: mcpInput(z.string().max(120).optional()),
  includeArchived: mcpInput(z.boolean().optional()),
})
const GetTaskInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
})

type WorkspaceOnlyArgs = z.infer<typeof WorkspaceOnlyInput>
type BoardScopedArgs = z.infer<typeof BoardScopedInput>
type ListTasksArgs = z.infer<typeof ListTasksInput>
type GetTaskArgs = z.infer<typeof GetTaskInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class KanbanTools {
  constructor(
    private readonly reads: KanbanReadService,
    private readonly writes: KanbanWriteService,
  ) {}

  @Tool({
    name: 'listKanbanBoards',
    description:
      'Список Kanban-досок (страниц типа KANBAN) рабочего пространства с активным ' +
      'спринтом каждой. Если доска одна — другие инструменты можно звать без boardPageId. ' +
      'Параметр: workspaceId.',
    parameters: WorkspaceOnlyInput,
  })
  listKanbanBoards(args: WorkspaceOnlyArgs, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.reads.listBoards(auth.userId, args.workspaceId)
  }

  @Tool({
    name: 'listSprints',
    description:
      'Список спринтов доски (id, name, status, startDate, endDate). Покрывает «какие у ' +
      'нас спринты». Параметры: workspaceId, boardPageId (опц. — авто, если доска одна).',
    parameters: BoardScopedInput,
  })
  listSprints(args: BoardScopedArgs, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.reads.listSprints(auth.userId, args.workspaceId, args.boardPageId)
  }

  @Tool({
    name: 'getActiveSprint',
    description: 'Активный спринт доски (или null). Покрывает «какой активный спринт». Параметры: workspaceId, boardPageId (опц.).',
    parameters: BoardScopedInput,
  })
  getActiveSprint(args: BoardScopedArgs, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.reads.getActiveSprint(auth.userId, args.workspaceId, args.boardPageId)
  }

  @Tool({
    name: 'listTasks',
    description:
      'Задачи доски с фильтрами. sprint: "current"|"backlog"|id|название; assignee: ' +
      '"me"|userId; status: название колонки. Покрывает «задачи в спринте / в текущем / у ' +
      'меня / у {человека}». Параметры: workspaceId, boardPageId (опц.), sprint?, assignee?, status?, includeArchived?.',
    parameters: ListTasksInput,
  })
  listTasks(args: ListTasksArgs, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.reads.listTasks(auth.userId, args.workspaceId, args.boardPageId, {
      sprint: args.sprint,
      assignee: args.assignee,
      status: args.status,
      includeArchived: args.includeArchived,
    })
  }

  @Tool({
    name: 'getTask',
    description: 'Детали задачи + последние события активности. Параметры: workspaceId, boardPageId (опц.), taskId.',
    parameters: GetTaskInput,
  })
  getTask(args: GetTaskArgs, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.reads.getTask(auth.userId, args.workspaceId, args.boardPageId, args.taskId)
  }
}
```

- [ ] **Step 4: Wire into `mcp.module.ts`**

Add imports:
```ts
import { KanbanGateway } from './services/kanban-gateway.service.js'
import { KanbanReadService } from './services/kanban-read.service.js'
import { KanbanWriteService } from './services/kanban-write.service.js'
import { KanbanTools } from './tools/kanban.tools.js'
```
Add `KanbanGateway`, `KanbanReadService`, `KanbanWriteService`, `KanbanTools` to `providers`; add `KanbanTools` to `exports`.

- [ ] **Step 5: Add read registry entries in agents**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add scope constants near the others:
```python
SCOPE_KANBAN_READ = 'kanban:read'
SCOPE_KANBAN_WRITE = 'kanban:write'
```
Add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'listKanbanBoards': ToolMeta('listKanbanBoards', SCOPE_KANBAN_READ, False,
                                  _summary_generic('listKanbanBoards'), _preview_default),
    'listSprints':      ToolMeta('listSprints', SCOPE_KANBAN_READ, False,
                                  _summary_generic('listSprints'), _preview_default),
    'getActiveSprint':  ToolMeta('getActiveSprint', SCOPE_KANBAN_READ, False,
                                  _summary_generic('getActiveSprint'), _preview_default),
    'listTasks':        ToolMeta('listTasks', SCOPE_KANBAN_READ, False,
                                  _summary_generic('listTasks'), _preview_default),
    'getTask':          ToolMeta('getTask', SCOPE_KANBAN_READ, False,
                                  _summary_generic('getTask'), _preview_default),
```

- [ ] **Step 6: Run tests + type-check, then commit**

Run: `pnpm --filter engines test -- kanban.tools && pnpm --filter engines check-types`
Expected: PASS (requires Task 6's `kanban-write.service.ts` to exist — see ordering note).

```bash
git add apps/engines/src/apps/mcp/tools/kanban.tools.ts apps/engines/src/apps/mcp/tools/kanban.tools.spec.ts apps/engines/src/apps/mcp/mcp.module.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add Kanban read tools (boards/sprints/tasks) + wiring"
```

> **Ordering note:** Task 5's `kanban.tools.ts` imports `KanbanWriteService` (Task 6). Implement **Task 6 before Task 5's type-check/commit** (or create the `kanban-write.service.ts` shell first). The subagent executor should run Task 6 immediately after Task 4, then Task 5, then Task 7.

## Task 6: type/priority resolvers + `KanbanWriteService`

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/kanban-gateway.service.ts`
- Create: `apps/engines/src/apps/mcp/services/kanban-write.service.ts`
- Test: `apps/engines/src/apps/mcp/services/kanban-write.service.spec.ts`

- [ ] **Step 1: Add type/priority resolvers to the gateway**

In `kanban-gateway.service.ts`, add inside `KanbanGateway`:

```ts
  async resolveTypeByName(boardPageId: string, value: string): Promise<string> {
    const types = await this.prisma.kanbanType.findMany({
      where: { pageId: boardPageId },
      select: { id: true, title: true },
    })
    const v = value.trim().toLowerCase()
    const hit = types.find((t) => t.id === value || t.title.trim().toLowerCase() === v)
    if (!hit) throw new BadRequestException(`Unknown task type "${value}". Available: ${types.map((t) => `"${t.title}"`).join(', ')}`)
    return hit.id
  }

  async resolvePriorityByName(boardPageId: string, value: string): Promise<string> {
    const priorities = await this.prisma.kanbanPriority.findMany({
      where: { pageId: boardPageId },
      select: { id: true, title: true },
    })
    const v = value.trim().toLowerCase()
    const hit = priorities.find((p) => p.id === value || p.title.trim().toLowerCase() === v)
    if (!hit) throw new BadRequestException(`Unknown priority "${value}". Available: ${priorities.map((p) => `"${p.title}"`).join(', ')}`)
    return hit.id
  }
```

- [ ] **Step 2: Write the failing write-service test**

Create `apps/engines/src/apps/mcp/services/kanban-write.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'

import type { MarkdownParser } from './markdown-parser.service.js'
import type { KanbanGateway } from './kanban-gateway.service.js'
import { KanbanWriteService } from './kanban-write.service.js'

function makeGateway() {
  const task = { create: jest.fn(), move: jest.fn(), update: jest.fn(), setAssignees: jest.fn(), archive: jest.fn() }
  const sprint = { create: jest.fn(), activate: jest.fn(), complete: jest.fn() }
  const comment = { create: jest.fn() }
  const gateway = {
    resolveBoardPageId: jest.fn(async (_u: string, _w: string, b?: string | null) => b ?? 'b1'),
    resolveColumnByStatus: jest.fn(async () => 'col-done'),
    resolveSprintTarget: jest.fn(async () => 's-next'),
    findCancelColumn: jest.fn(async () => null),
    resolveAssignee: jest.fn((uid: string, v: string) => (v === 'me' ? uid : v)),
    currentAssigneeIds: jest.fn(async () => ['u2']),
    caller: jest.fn(() => ({ task, sprint, comment })),
    run: jest.fn((fn: () => unknown) => fn()),
  } as unknown as KanbanGateway
  return { gateway, task, sprint, comment }
}

describe('KanbanWriteService', () => {
  const parser = { parse: jest.fn((md: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: md }] }] })) } as unknown as MarkdownParser
  let svc: KanbanWriteService
  let mocks: ReturnType<typeof makeGateway>

  beforeEach(() => {
    jest.clearAllMocks()
    mocks = makeGateway()
    svc = new KanbanWriteService(mocks.gateway, parser)
  })

  it('moveTaskToStatus resolves the column and appends (beforeId/afterId null)', async () => {
    mocks.task.move.mockResolvedValue({ id: 't1' })
    await svc.moveTaskToStatus('u1', 'w1', { boardPageId: 'b1', taskId: 't1', status: 'Done' })
    expect(mocks.task.move).toHaveBeenCalledWith({ pageId: 'b1', id: 't1', targetColumnId: 'col-done', beforeId: null, afterId: null })
  })

  it('cancelTask archives when the board has no CANCELLED column', async () => {
    mocks.task.archive.mockResolvedValue({ ok: true })
    const out = await svc.cancelTask('u1', 'w1', { boardPageId: 'b1', taskId: 't1' })
    expect(mocks.task.archive).toHaveBeenCalledWith({ pageId: 'b1', id: 't1' })
    expect(out).toEqual({ ok: true, via: 'archive' })
  })

  it('assignTask merges the new assignee with existing ones', async () => {
    mocks.task.setAssignees.mockResolvedValue({ ok: true })
    await svc.assignTask('u1', 'w1', { boardPageId: 'b1', taskId: 't1', user: 'me' })
    expect(mocks.task.setAssignees).toHaveBeenCalledWith({ pageId: 'b1', id: 't1', userIds: ['u2', 'u1'] })
  })

  it('addTaskComment parses markdown to Tiptap content', async () => {
    mocks.comment.create.mockResolvedValue({ id: 'cm1' })
    const out = await svc.addTaskComment('u1', 'w1', { boardPageId: 'b1', taskId: 't1', markdown: 'hi' })
    expect(parser.parse).toHaveBeenCalledWith('hi')
    expect(out).toEqual({ commentId: 'cm1' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter engines test -- kanban-write.service`
Expected: FAIL — cannot find module `./kanban-write.service.js`.

- [ ] **Step 4: Implement `KanbanWriteService`**

Create `apps/engines/src/apps/mcp/services/kanban-write.service.ts`:

```ts
import { Injectable } from '@nestjs/common'

import { KanbanGateway } from './kanban-gateway.service.js'
import { MarkdownParser } from './markdown-parser.service.js'

type Board = { boardPageId?: string | null }

@Injectable()
export class KanbanWriteService {
  constructor(
    private readonly gateway: KanbanGateway,
    private readonly parser: MarkdownParser,
  ) {}

  async createTask(
    userId: string,
    ws: string,
    a: Board & {
      title: string
      status?: string
      type?: string
      priority?: string
      sprint?: string
      assignees?: string[]
      dueDate?: Date
    },
  ) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const columnId = a.status ? await this.gateway.resolveColumnByStatus(board, a.status) : undefined
    const typeId = a.type ? await this.gateway.resolveTypeByName(board, a.type) : undefined
    const priorityId = a.priority ? await this.gateway.resolvePriorityByName(board, a.priority) : undefined
    const sprintId = a.sprint ? ((await this.gateway.resolveSprintTarget(board, a.sprint)) ?? undefined) : undefined
    const k = this.gateway.caller(userId)
    const task = await this.gateway.run(() =>
      k.task.create({ pageId: board, title: a.title, columnId, typeId, priorityId, sprintId }),
    )
    if (a.assignees?.length) {
      const userIds = [...new Set(a.assignees.map((x) => this.gateway.resolveAssignee(userId, x)))]
      await this.gateway.run(() => k.task.setAssignees({ pageId: board, id: task.id, userIds }))
    }
    if (a.dueDate) {
      await this.gateway.run(() => k.task.update({ pageId: board, id: task.id, dueDate: a.dueDate }))
    }
    return { taskId: task.id }
  }

  async moveTaskToStatus(userId: string, ws: string, a: Board & { taskId: string; status: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const targetColumnId = await this.gateway.resolveColumnByStatus(board, a.status)
    await this.gateway.run(() =>
      this.gateway.caller(userId).task.move({ pageId: board, id: a.taskId, targetColumnId, beforeId: null, afterId: null }),
    )
    return { ok: true as const }
  }

  async assignTask(userId: string, ws: string, a: Board & { taskId: string; user: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const target = this.gateway.resolveAssignee(userId, a.user)
    const current = await this.gateway.currentAssigneeIds(a.taskId)
    const userIds = [...new Set([...current, target])]
    await this.gateway.run(() => this.gateway.caller(userId).task.setAssignees({ pageId: board, id: a.taskId, userIds }))
    return { ok: true as const }
  }

  async unassignTask(userId: string, ws: string, a: Board & { taskId: string; user: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const target = this.gateway.resolveAssignee(userId, a.user)
    const current = await this.gateway.currentAssigneeIds(a.taskId)
    const userIds = current.filter((id) => id !== target)
    await this.gateway.run(() => this.gateway.caller(userId).task.setAssignees({ pageId: board, id: a.taskId, userIds }))
    return { ok: true as const }
  }

  async setTaskDates(userId: string, ws: string, a: Board & { taskId: string; startDate?: Date; dueDate?: Date }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    await this.gateway.run(() =>
      this.gateway.caller(userId).task.update({ pageId: board, id: a.taskId, startDate: a.startDate, dueDate: a.dueDate }),
    )
    return { ok: true as const }
  }

  async setTaskSprint(userId: string, ws: string, a: Board & { taskId: string; target: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const sprintId = await this.gateway.resolveSprintTarget(board, a.target)
    await this.gateway.run(() => this.gateway.caller(userId).task.update({ pageId: board, id: a.taskId, sprintId }))
    return { ok: true as const }
  }

  async setTaskPriority(userId: string, ws: string, a: Board & { taskId: string; value: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const priorityId = await this.gateway.resolvePriorityByName(board, a.value)
    await this.gateway.run(() => this.gateway.caller(userId).task.update({ pageId: board, id: a.taskId, priorityId }))
    return { ok: true as const }
  }

  async setTaskType(userId: string, ws: string, a: Board & { taskId: string; value: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const typeId = await this.gateway.resolveTypeByName(board, a.value)
    await this.gateway.run(() => this.gateway.caller(userId).task.update({ pageId: board, id: a.taskId, typeId }))
    return { ok: true as const }
  }

  async cancelTask(userId: string, ws: string, a: Board & { taskId: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const cancelColumnId = await this.gateway.findCancelColumn(board)
    const k = this.gateway.caller(userId)
    if (cancelColumnId) {
      await this.gateway.run(() =>
        k.task.move({ pageId: board, id: a.taskId, targetColumnId: cancelColumnId, beforeId: null, afterId: null }),
      )
      return { ok: true as const, via: 'column' as const }
    }
    await this.gateway.run(() => k.task.archive({ pageId: board, id: a.taskId }))
    return { ok: true as const, via: 'archive' as const }
  }

  async addTaskComment(userId: string, ws: string, a: Board & { taskId: string; markdown: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const content = this.parser.parse(a.markdown)
    const comment = await this.gateway.run(() =>
      this.gateway.caller(userId).comment.create({ pageId: board, taskId: a.taskId, content }),
    )
    return { commentId: comment.id }
  }

  async createSprint(
    userId: string,
    ws: string,
    a: Board & { name: string; description?: string; startDate?: Date; endDate?: Date },
  ) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const sprint = await this.gateway.run(() =>
      this.gateway.caller(userId).sprint.create({
        pageId: board,
        name: a.name,
        description: a.description,
        startDate: a.startDate,
        endDate: a.endDate,
      }),
    )
    return { sprintId: sprint.id }
  }

  async startSprint(userId: string, ws: string, a: Board & { sprintId: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    await this.gateway.run(() => this.gateway.caller(userId).sprint.activate({ pageId: board, id: a.sprintId }))
    return { ok: true as const }
  }

  async closeSprint(userId: string, ws: string, a: Board & { sprintId: string; moveUndoneTo?: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const moveUndoneTo =
      a.moveUndoneTo !== undefined ? await this.gateway.resolveSprintTarget(board, a.moveUndoneTo) : null
    await this.gateway.run(() =>
      this.gateway.caller(userId).sprint.complete({ pageId: board, id: a.sprintId, moveUndoneTo }),
    )
    return { ok: true as const }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter engines test -- kanban-write.service && pnpm --filter engines check-types`
Expected: PASS. (`check-types` now resolves `kanban.tools.ts`'s `KanbanWriteService` import from Task 5.)

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/mcp/services/kanban-gateway.service.ts apps/engines/src/apps/mcp/services/kanban-write.service.ts apps/engines/src/apps/mcp/services/kanban-write.service.spec.ts
git commit -m "feat(mcp): add Kanban write service (task + sprint mutations via caller)"
```

---

## Task 7: Kanban write tools + registry

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/kanban.tools.ts`
- Modify: `apps/engines/src/apps/mcp/tools/kanban.tools.spec.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Add failing write-tool tests**

Append to `apps/engines/src/apps/mcp/tools/kanban.tools.spec.ts` a second `describe` block:

```ts
describe('KanbanTools (writes)', () => {
  const moveTaskToStatus = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const cancelTask = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const writes = {
    createTask: jest.fn(), moveTaskToStatus, assignTask: jest.fn(), unassignTask: jest.fn(),
    setTaskDates: jest.fn(), setTaskSprint: jest.fn(), setTaskPriority: jest.fn(), setTaskType: jest.fn(),
    cancelTask, addTaskComment: jest.fn(), createSprint: jest.fn(), startSprint: jest.fn(), closeSprint: jest.fn(),
  } as unknown as import('../services/kanban-write.service.js').KanbanWriteService
  const reads = {} as unknown as import('../services/kanban-read.service.js').KanbanReadService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as import('../../api/auth/auth-context.js').AuthedRequest
  let tools: KanbanTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new KanbanTools(reads, writes)
  })

  it('moveTaskToStatus forwards to the write service', async () => {
    moveTaskToStatus.mockResolvedValue({ ok: true })
    const out = await tools.moveTaskToStatus({ workspaceId: 'w1', boardPageId: 'b1', taskId: 't1', status: 'Done' }, {} as never, req)
    expect(out).toEqual({ ok: true })
    expect(moveTaskToStatus).toHaveBeenCalledWith('u1', 'w1', { boardPageId: 'b1', taskId: 't1', status: 'Done' })
  })

  it('cancelTask forwards to the write service', async () => {
    cancelTask.mockResolvedValue({ ok: true, via: 'archive' })
    const out = await tools.cancelTask({ workspaceId: 'w1', boardPageId: 'b1', taskId: 't1' }, {} as never, req)
    expect(out).toEqual({ ok: true, via: 'archive' })
  })
})
```
(The `KanbanTools` import already exists at the top of the spec from Task 5.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- kanban.tools`
Expected: FAIL — write tool methods not defined.

- [ ] **Step 3: Add the write tools to `KanbanTools`**

In `apps/engines/src/apps/mcp/tools/kanban.tools.ts`, add these input schemas near the read schemas:

```ts
const CreateTaskInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  title: z.string().min(1).max(500),
  status: mcpInput(z.string().max(120).optional()),
  type: mcpInput(z.string().max(120).optional()),
  priority: mcpInput(z.string().max(120).optional()),
  sprint: mcpInput(z.string().max(120).optional()),
  assignees: mcpInput(z.array(z.string().min(1)).optional()),
  dueDate: mcpInput(z.coerce.date().optional()),
})
const MoveTaskInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  status: z.string().min(1).max(120),
})
const AssignInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  user: z.string().min(1).max(64),
})
const SetDatesInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  startDate: mcpInput(z.coerce.date().optional()),
  dueDate: mcpInput(z.coerce.date().optional()),
})
const SetSprintInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  target: z.string().min(1).max(120),
})
const SetFieldInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  value: z.string().min(1).max(120),
})
const TaskIdInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
})
const AddCommentInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  markdown: z.string().min(1).max(20_000),
})
const CreateSprintInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  name: z.string().min(1).max(120),
  description: mcpInput(z.string().max(2000).optional()),
  startDate: mcpInput(z.coerce.date().optional()),
  endDate: mcpInput(z.coerce.date().optional()),
})
const SprintIdInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  sprintId: mcpUuid(),
})
const CloseSprintInput = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  sprintId: mcpUuid(),
  moveUndoneTo: mcpInput(z.string().max(120).optional()),
})
```

Add these methods inside `KanbanTools` (each `requireAuth` → write service):

```ts
  @Tool({
    name: 'createTask',
    description:
      'Создаёт задачу на доске. status — название колонки; sprint — "current"|"next"|"backlog"|id|название; ' +
      'assignees — ["me"|userId]; type/priority — название. Требует подтверждения. Параметры: ' +
      'workspaceId, boardPageId (опц.), title, status?, type?, priority?, sprint?, assignees?, dueDate?.',
    parameters: CreateTaskInput,
  })
  createTask(args: z.infer<typeof CreateTaskInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.createTask(auth.userId, args.workspaceId, {
      boardPageId: args.boardPageId, title: args.title, status: args.status, type: args.type,
      priority: args.priority, sprint: args.sprint, assignees: args.assignees, dueDate: args.dueDate,
    })
  }

  @Tool({
    name: 'moveTaskToStatus',
    description: 'Перемещает задачу в колонку-статус по названию. Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId, status.',
    parameters: MoveTaskInput,
  })
  moveTaskToStatus(args: z.infer<typeof MoveTaskInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.moveTaskToStatus(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId, status: args.status })
  }

  @Tool({
    name: 'assignTask',
    description: 'Назначает участника на задачу ("me" или userId). Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId, user.',
    parameters: AssignInput,
  })
  assignTask(args: z.infer<typeof AssignInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.assignTask(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId, user: args.user })
  }

  @Tool({
    name: 'unassignTask',
    description: 'Снимает участника с задачи ("me" или userId). Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId, user.',
    parameters: AssignInput,
  })
  unassignTask(args: z.infer<typeof AssignInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.unassignTask(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId, user: args.user })
  }

  @Tool({
    name: 'setTaskDates',
    description: 'Ставит срок задачи: startDate (от) и/или dueDate (до), ISO 8601. Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId, startDate?, dueDate?.',
    parameters: SetDatesInput,
  })
  setTaskDates(args: z.infer<typeof SetDatesInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.setTaskDates(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId, startDate: args.startDate, dueDate: args.dueDate })
  }

  @Tool({
    name: 'setTaskSprint',
    description: 'Переносит задачу в спринт: target = "current"|"next"|"backlog"|id|название. Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId, target.',
    parameters: SetSprintInput,
  })
  setTaskSprint(args: z.infer<typeof SetSprintInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.setTaskSprint(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId, target: args.target })
  }

  @Tool({
    name: 'setTaskPriority',
    description: 'Ставит приоритет задачи (название приоритета). Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId, value.',
    parameters: SetFieldInput,
  })
  setTaskPriority(args: z.infer<typeof SetFieldInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.setTaskPriority(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId, value: args.value })
  }

  @Tool({
    name: 'setTaskType',
    description: 'Ставит тип задачи (название типа). Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId, value.',
    parameters: SetFieldInput,
  })
  setTaskType(args: z.infer<typeof SetFieldInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.setTaskType(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId, value: args.value })
  }

  @Tool({
    name: 'cancelTask',
    description: 'Отменяет задачу: переносит в колонку-CANCELLED, если она есть, иначе архивирует. Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId.',
    parameters: TaskIdInput,
  })
  cancelTask(args: z.infer<typeof TaskIdInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.cancelTask(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId })
  }

  @Tool({
    name: 'addTaskComment',
    description: 'Добавляет комментарий к задаче (Markdown). Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), taskId, markdown.',
    parameters: AddCommentInput,
  })
  addTaskComment(args: z.infer<typeof AddCommentInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.addTaskComment(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, taskId: args.taskId, markdown: args.markdown })
  }

  @Tool({
    name: 'createSprint',
    description: 'Создаёт спринт (PLANNED). Только владелец/создатель доски. Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), name, description?, startDate?, endDate?.',
    parameters: CreateSprintInput,
  })
  createSprint(args: z.infer<typeof CreateSprintInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.createSprint(auth.userId, args.workspaceId, {
      boardPageId: args.boardPageId, name: args.name, description: args.description, startDate: args.startDate, endDate: args.endDate,
    })
  }

  @Tool({
    name: 'startSprint',
    description: 'Запускает спринт (делает активным; прочие активные → PLANNED). Только владелец/создатель доски. Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), sprintId.',
    parameters: SprintIdInput,
  })
  startSprint(args: z.infer<typeof SprintIdInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.startSprint(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, sprintId: args.sprintId })
  }

  @Tool({
    name: 'closeSprint',
    description: 'Завершает спринт; незавершённые задачи переносятся в moveUndoneTo ("next"|"backlog"|id|название; по умолчанию беклог). Только владелец/создатель. Требует подтверждения. Параметры: workspaceId, boardPageId (опц.), sprintId, moveUndoneTo?.',
    parameters: CloseSprintInput,
  })
  closeSprint(args: z.infer<typeof CloseSprintInput>, _c: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.writes.closeSprint(auth.userId, args.workspaceId, { boardPageId: args.boardPageId, sprintId: args.sprintId, moveUndoneTo: args.moveUndoneTo })
  }
```

- [ ] **Step 4: Add write registry entries in agents**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'createTask':        ToolMeta('createTask', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Создать задачу «{_truncate(a.get("title"))}»', _preview_default),
    'moveTaskToStatus':  ToolMeta('moveTaskToStatus', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Переместить задачу {a.get("taskId")} → {a.get("status")}', _preview_default),
    'assignTask':        ToolMeta('assignTask', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Назначить {a.get("user")} на задачу {a.get("taskId")}', _preview_default),
    'unassignTask':      ToolMeta('unassignTask', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Снять {a.get("user")} с задачи {a.get("taskId")}', _preview_default),
    'setTaskDates':      ToolMeta('setTaskDates', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Сроки задачи {a.get("taskId")}', _preview_default),
    'setTaskSprint':     ToolMeta('setTaskSprint', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Задача {a.get("taskId")} → спринт {a.get("target")}', _preview_default),
    'setTaskPriority':   ToolMeta('setTaskPriority', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Приоритет задачи {a.get("taskId")} = {a.get("value")}', _preview_default),
    'setTaskType':       ToolMeta('setTaskType', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Тип задачи {a.get("taskId")} = {a.get("value")}', _preview_default),
    'cancelTask':        ToolMeta('cancelTask', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Отменить задачу {a.get("taskId")}', _preview_default),
    'addTaskComment':    ToolMeta('addTaskComment', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Комментарий к задаче {a.get("taskId")}', _preview_default),
    'createSprint':      ToolMeta('createSprint', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Создать спринт «{_truncate(a.get("name"))}»', _preview_default),
    'startSprint':       ToolMeta('startSprint', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Запустить спринт {a.get("sprintId")}', _preview_default),
    'closeSprint':       ToolMeta('closeSprint', SCOPE_KANBAN_WRITE, True,
                                   lambda a: f'Завершить спринт {a.get("sprintId")}', _preview_default),
```

- [ ] **Step 5: Run tests + type-check, then commit**

Run: `pnpm --filter engines test -- kanban && pnpm --filter engines check-types && pnpm --filter engines lint`
Expected: PASS, lint clean (`--max-warnings 0`).

```bash
git add apps/engines/src/apps/mcp/tools/kanban.tools.ts apps/engines/src/apps/mcp/tools/kanban.tools.spec.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add Kanban write tools (tasks + sprints)"
```

---

## Task 8: Integration test + scope drift-guard + gates + spec status

**Files:**
- Create: `apps/engines/test/integration/kanban-caller.int-spec.ts` (or the repo's `test-int` location/extension)
- Modify: `apps/web/test/agents-token.test.ts`
- Modify: `docs/superpowers/specs/2026-05-29-kanban-mcp-tooling-design.md`

- [ ] **Step 1: Integration test — synthetic context → real procedure**

Check the engines integration config first: `cat apps/engines/jest.integration.config.ts` to confirm the test glob/location and how it gets Prisma/DB (requires `docker compose up -d`). Then create `apps/engines/test/integration/kanban-caller.int-spec.ts` (adjust path to match the config's `roots`/`testMatch`):

```ts
import { describe, it, expect, afterAll } from '@jest/globals'
import { prisma } from '@repo/db'
import { createKanbanCaller } from '@repo/trpc/helpers/kanban-caller'

// Proves the engines-built synthetic context drives the real kanban procedures:
// transactions, TaskActivity audit, and column transitions all run.
describe('createKanbanCaller (integration)', () => {
  const ids: { workspaceId?: string; userId?: string; pageId?: string } = {}

  afterAll(async () => {
    if (ids.pageId) await prisma.page.delete({ where: { id: ids.pageId } }).catch(() => undefined)
    if (ids.workspaceId) await prisma.workspace.delete({ where: { id: ids.workspaceId } }).catch(() => undefined)
    if (ids.userId) await prisma.user.delete({ where: { id: ids.userId } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  it('creates and moves a task, writing a MOVED activity row', async () => {
    const user = await prisma.user.create({ data: { email: `k-${Date.now()}@test.local`, firstName: 'K', lastName: 'T' } })
    ids.userId = user.id
    const ws = await prisma.workspace.create({ data: { name: 'KB ITest', createdById: user.id } })
    ids.workspaceId = ws.id
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' } })
    const page = await prisma.page.create({ data: { workspaceId: ws.id, type: 'KANBAN', title: 'Board', createdById: user.id } })
    ids.pageId = page.id
    const [todo, done] = await Promise.all([
      prisma.kanbanColumn.create({ data: { pageId: page.id, title: 'Todo', kind: 'ACTIVE', position: 1024 } }),
      prisma.kanbanColumn.create({ data: { pageId: page.id, title: 'Done', kind: 'DONE', position: 2048 } }),
    ])

    const ctx = {
      prisma,
      user: { id: user.id },
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: { createPayment: async () => { throw new Error('x') }, getPayment: async () => { throw new Error('x') } },
      returnUrlBase: '',
    }
    const k = createKanbanCaller(ctx as never).kanban

    const task = await k.task.create({ pageId: page.id, title: 'Ship it' })
    expect(task.columnId).toBe(todo.id)

    await k.task.move({ pageId: page.id, id: task.id, targetColumnId: done.id, beforeId: null, afterId: null })
    const moved = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(moved.columnId).toBe(done.id)

    const activity = await prisma.taskActivity.findMany({ where: { taskId: task.id }, select: { type: true } })
    const types = activity.map((a) => a.type)
    expect(types).toContain('CREATED')
    expect(types).toContain('MOVED')
    expect(types).toContain('STATUS_CHANGED') // ACTIVE → DONE
  })
})
```

- [ ] **Step 2: Run the integration test**

Run: `docker compose up -d && pnpm --filter engines test-int -- kanban-caller`
Expected: PASS. (If the integration harness seeds users/consents differently, mirror the existing int-spec setup. If a User requires consent rows or extra fields, copy the pattern from another engines `*.int-spec.ts`. If no engines integration harness exists, instead add a runtime-import smoke to a unit test: `import { createKanbanCaller } from '@repo/trpc/helpers/kanban-caller'` + assert `typeof createKanbanCaller(stubCtx).kanban.task.create === 'function'`, proving the narrow graph loads in the engines runtime without pulling UI.)

- [ ] **Step 3: Extend the scope drift-guard**

In `apps/web/test/agents-token.test.ts`, add `'kanban:read'` to `REQUIRED_READ` and `'kanban:write'` to `REQUIRED_WRITE` (the kanban scopes are already granted in `agents-token.ts`; this keeps the registry↔JWT guard complete).

Run: `pnpm --filter web test -- agents-token`
Expected: PASS (both kanban scopes already granted to OWNER/EDITOR; not to VIEWER's write).

- [ ] **Step 4: Full gates**

Run (with repo `.env` sourced): `pnpm --filter engines lint && pnpm --filter engines check-types && pnpm --filter engines test && pnpm --filter @repo/trpc test && pnpm gates`
Expected: PASS. (If `web#check-types` fails on a stale `.next/types` for a deleted route, `rm -rf apps/web/.next/types` and re-run — unrelated to this branch.)

- [ ] **Step 5: Mark the spec implemented + commit**

In `docs/superpowers/specs/2026-05-29-kanban-mcp-tooling-design.md`, change the status line to `**Status:** Implemented`.

```bash
git add apps/engines/test/integration/kanban-caller.int-spec.ts apps/web/test/agents-token.test.ts docs/superpowers/specs/2026-05-29-kanban-mcp-tooling-design.md
git commit -m "test(mcp): kanban caller integration + scope drift-guard; mark spec implemented"
```

---

## Self-Review

**Spec coverage:**
- Reuse via `createKanbanCaller` → Task 1 (helper) + Task 2 (gateway). ✔
- Board auto/explicit selection → Task 4 (`resolveBoardPageId`). ✔
- Reads (boards/sprints/active/tasks/task) → Tasks 4–5. ✔
- Task writes (create/move/assign/dates/sprint/priority/type/cancel/comment) → Tasks 6–7. ✔
- Sprint lifecycle (create/start/close, owner-gated via inherited `assertPageOwnership`) → Tasks 6–7. ✔
- Status→column / sprint / cancel / type / priority / assignee resolvers → Tasks 3, 4, 6. ✔
- Authz inherited + workspace/board guard (`assertBoard`) → Task 2. ✔
- Scopes `kanban:read|write` (already granted) + registry entries + drift-guard → Tasks 5, 7, 8. ✔
- Item-8 cases + UC3 → covered by the tool set; integration test proves the caller path. ✔
- Realtime caveat, task-numbers deferral → documented in spec (no code). ✔

**Type/name consistency:** `KanbanGateway` methods (`caller`, `run`, `assertBoard`, `resolveBoardPageId`, `resolveColumnByStatus`, `resolveSprintTarget`, `findCancelColumn`, `resolveTypeByName`, `resolvePriorityByName`, `resolveAssignee`, `currentAssigneeIds`) are defined before use; `KanbanReadService`/`KanbanWriteService`/`KanbanTools` constructor arities match the `mcp.module.ts` providers; tool→service method names line up; caller calls use the exact procedure inputs (`move` with `beforeId/afterId: null`, `complete` with `moveUndoneTo`). `createKanbanCaller` import path (`@repo/trpc/helpers/kanban-caller`) matches the Task 1 file + the proven `./helpers/*` export rule.

**Placeholder scan:** none — every step has complete code/commands. The integration test (Task 8) documents an explicit fallback if the `test-int` harness differs.

**Deviations from spec:** none material. (Reads use direct Prisma rather than `getBoard`, as the spec's Architecture section specifies.)

## Notes for the executor

- **Task ordering:** 1 → 2 → 3 → 4 → **6 → 5** → 7 → 8. `kanban.tools.ts` (Task 5) imports `KanbanWriteService` (Task 6), so create the write service before Task 5 type-checks/commits. (Reads logic in Task 4 has no dependency on writes.)
- Engines unit tests mock the gateway/services — the intricate kanban logic is covered by `@repo/trpc`'s own suite; the integration test (Task 8) proves the reuse wiring.
- Do **not** `--no-verify`. Keep each commit green. The kanban scopes are already in `agents-token.ts` — no web change beyond the drift-guard list.


