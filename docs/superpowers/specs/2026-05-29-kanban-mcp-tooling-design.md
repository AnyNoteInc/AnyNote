# Kanban MCP Tooling — Design

**Status:** Draft, awaiting user review
**Date:** 2026-05-29
**Scope:** Add Kanban task/sprint-management MCP tools to `apps/engines` by **reusing** the existing tRPC kanban procedures through a server-side `createCaller`, rather than reimplementing the (intricate) board logic. Covers request item 8 + use case UC3. Board-configuration CRUD (columns/types/priorities/labels) and human-readable task numbers are **out of scope**.

## Goal

Let the chat agent drive a Kanban board the way the UI does, covering every item-8 case and UC3 (small-team Kanban):

- «какие у нас есть спринты?» / «какой активный спринт сейчас» / «какие задачи в спринте X / в текущем / у меня / у {человека}»
- «передвинь задачу в статус X» / «отмени задачу» / «назначь/сними меня» / «поставь срок от и до» / «перемести в следующий спринт / беклог / в спринт X»
- UC3: lead starts a sprint, watches progress, sends a task back (move column), comments on a card.

This is **one cohesive subsystem** (a single spec/plan). It builds on the MCP tooling shipped in [2026-05-28-mcp-tooling-expansion-design.md](docs/superpowers/specs/2026-05-28-mcp-tooling-expansion-design.md) (same `@Tool` + `requireAuth`/`assertMember` + `tool_registry.py` conventions, and the **scope contract** lesson).

## Non-goals

- **Board configuration CRUD** (create/rename/reorder/delete columns, types, priorities, labels). That is owner-level board setup done in the UI; the agent operates *within* an existing board. (`KanbanColumnKind`-aware tools only *read* columns to resolve status names.)
- **Human-readable task numbers** (e.g. `BOARD-123`). `Task` has no number field; adding one is a DB migration + UI feature. Tasks are identified by **title (list → match) → id**, like reminders. Deferred as its own product feature.
- **Realtime live-push** to open boards. Server-side writes from engines emit to the `kanbanBus` instance in the **engines process**; browsers on the board see changes on next refresh/reconnect. Same accepted limitation as MCP page writes.
- **Reimplementing kanban business logic** in engines. We reuse the tRPC procedures (see Architecture).
- **A "default board"** concept. A workspace may have many KANBAN pages; the agent resolves which board (see Board resolution).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| How engines runs kanban logic | **Reuse tRPC via `createCaller`** (server-side caller over a kanban-only router) |
| Board selection | **Auto + explicit `boardPageId`** — `listKanbanBoards`; single board ⇒ default, many ⇒ agent lists & picks |
| Tool scope | **Reads + task ops + sprint lifecycle** (no board-config CRUD) |
| Task identification | **By title + id** (list → match → act); task numbers deferred |
| "Cancel a task" | Move to a `CANCELLED`-kind column if the board has one, else **archive** |

## Architecture

```
apps/agents (chat agent, kanban:read/kanban:write in JWT)   external MCP client
        │  tools/call (boardPageId, …) — workspaceId injected        │
        ▼                                                            ▼
   apps/engines  POST /mcp
   ┌───────────────────────────────────────────────────────────────┐
   │ tools/kanban.tools.ts        ~18 @Tool methods (thin)           │
   │   requireAuth → assert board ∈ injected workspace → delegate    │
   │ services/kanban-gateway.service.ts                              │
   │   • READS: targeted Prisma queries (sprints/tasks/boards)       │
   │   • WRITES: createKanbanCaller(ctx).kanban.<sub>.<proc>(…)       │
   │   • mapTrpcError(TRPCError → MCP HttpException)                  │
   │   • status/sprint/task resolvers                                │
   └───────────────────────────────────────────────────────────────┘
        │ Prisma (@repo/db)                  │ createKanbanCaller (synthetic ctx)
        ▼                                    ▼
   Postgres (kanban tables)        @repo/trpc/helpers/kanban-caller
                                     → router({ kanban: kanbanRouter })
                                     → existing kanban procedures
                                       (positions, TaskActivity, single-active-sprint,
                                        sprint-complete migration, assertPageAccess/Ownership)
```

### Reuse mechanism (verified viable)

- engines **already** depends on `@repo/trpc` and runtime-imports `@repo/trpc/helpers/plan` ([subscription-renewal.service.ts](apps/engines/src/apps/billing/services/subscription-renewal.service.ts)); Node 25 strips TS types at runtime, so source-TS workspace packages execute from engines. No new dependency.
- New **server-only** helper `packages/trpc/src/helpers/kanban-caller.ts`:
  ```ts
  import { createCallerFactory, router } from '../trpc'
  import { kanbanRouter } from '../routers/kanban'
  export const createKanbanCaller = createCallerFactory(router({ kanban: kanbanRouter }))
  export type KanbanCaller = ReturnType<typeof createKanbanCaller>
  ```
  Importing **only** `kanbanRouter` (not the full `appRouter`) keeps engines' loaded graph server-safe — it avoids `@repo/ui`/editor/tiptap that the full `appRouter` would pull. Resolves via the proven `@repo/trpc/helpers/*` → `./src/helpers/*.ts` export rule.
- **`KanbanGateway`** (engines) builds the synthetic context and calls the caller:
  ```ts
  const ctx = {
    prisma,
    user: { id: userId } as Context['user'],   // procedures only read user.id
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: YOOKASSA_STUB,                    // kanban never touches it
    returnUrlBase: '',
  }
  return createKanbanCaller(ctx).kanban
  ```
  `protectedProcedure` only checks `ctx.user` truthiness, so the injected user passes; `assertPageAccess`/`assertPageOwnership` enforce the real authorization on `ctx.user.id`.
- **`mapTrpcError(e)`**: `TRPCError` → existing MCP `HttpException` errors (`NOT_FOUND`→404, `FORBIDDEN`→403, `CONFLICT`→409, `BAD_REQUEST`→400) so the engines exception filter returns clean messages.
- **Workspace guard:** every tool resolves `boardPageId`, loads `page.{workspaceId,type}`, and rejects unless `type==='KANBAN'` **and** `workspaceId === injected workspaceId` (`PageNotFoundError`). This scopes the agent to its active workspace before any caller/Prisma work; procedure-level `assertPageAccess` is the second line of defense.

### Reads vs writes

- **Reads** (`listKanbanBoards`, `listSprints`, `getActiveSprint`, `listTasks`, `getTask`) use **targeted Prisma queries** in the gateway (lighter than the full `getBoard` snapshot), guarded by `assertMember(workspaceId)` + the board guard. Task reads mirror the `getBoard` select shape (column, type, priority, sprint, assignees→user names, labels, dates, archived).
- **Writes** go through the **caller** so all transactions, `TaskActivity` audit rows, fractional positions, the single-ACTIVE-sprint invariant, and sprint-complete task migration are reused exactly.

## Tool inventory (~18: 5 reads + 13 writes)

Legend: **C?** = requires confirmation. `board` = `boardPageId`. `ws` = injected `workspaceId`. Scopes: `kanban:read` / `kanban:write` (already granted in [agents-token.ts](apps/web/src/lib/agents-token.ts)).

### Reads (`kanban:read`, no confirmation)

| Tool | Params | Behavior |
|---|---|---|
| `listKanbanBoards` | `ws` | KANBAN pages in the workspace → `{ boardPageId, title, icon, activeSprint?: {id,name} }[]`. If exactly one, downstream tools may omit `board`. Covers board selection. |
| `listSprints` | `board` | Sprints of the board → `{ id, name, status, startDate, endDate }[]` (ordered by position). Covers «какие спринты». |
| `getActiveSprint` | `board` | The `status==='ACTIVE'` sprint (or null). Covers «какой активный спринт». |
| `listTasks` | `board`, `sprint?` (`current`\|`backlog`\|sprintId\|name), `assignee?` (`me`\|userId), `status?` (column name), `includeArchived?` | Tasks with filters → `{ id, title, status(column), sprint, assignees:[{userId,name}], priority, type, dueDate, startDate }[]`. Covers «задачи в спринте / в текущем / у меня / у {человека}». |
| `getTask` | `board`, `taskId` | Full task + recent `TaskActivity` (via `kanban.board.getActivity`). |

### Writes (`kanban:write`, **C? = ✔**)

| Tool | Params | Maps to | Covers |
|---|---|---|---|
| `createTask` | `board`, `title`, `status?`, `type?`, `priority?`, `sprint?`, `assignees?`, `dueDate?` | `kanban.task.create` (+ `setAssignees`/`update` if provided) | создание задачи |
| `moveTaskToStatus` | `board`, `taskId`, `status` | resolve status→columnId → `kanban.task.move` | «передвинь в статус X» |
| `assignTask` / `unassignTask` | `board`, `taskId`, `user` (`me`\|userId) | read current → `kanban.task.setAssignees` (diff add/remove) | «назначь/сними меня / {человека}» |
| `setTaskDates` | `board`, `taskId`, `startDate?`, `dueDate?` | `kanban.task.update` | «срок от и до» |
| `setTaskSprint` | `board`, `taskId`, `target` (`current`\|`next`\|`backlog`\|sprintId\|name) | resolve → `kanban.task.update({ sprintId })` | «в след. спринт / беклог / в спринт X» |
| `setTaskPriority` / `setTaskType` | `board`, `taskId`, `value` (name\|id) | resolve → `kanban.task.update` | приоритет/тип |
| `cancelTask` | `board`, `taskId` | CANCELLED column → `kanban.task.move`; else `kanban.task.archive` | «отмени задачу» |
| `addTaskComment` | `board`, `taskId`, `markdown` | `MarkdownParser.parse` → `kanban.comment.create` | комментарий в карточке (UC3) |
| `createSprint` | `board`, `name`, `description?`, `startDate?`, `endDate?` | `kanban.sprint.create` | планирование спринта |
| `startSprint` | `board`, `sprintId` | `kanban.sprint.activate` | UC3 «запускает спринт» |
| `closeSprint` | `board`, `sprintId`, `moveUndoneTo?` (`next`\|`backlog`\|sprintId) | `kanban.sprint.complete` | завершение спринта |

`createSprint`/`startSprint`/`closeSprint` are **owner/creator-gated** because `kanban.sprint.*` call `assertPageOwnership`; task ops are any-member via `assertPageAccess`. This authorization is inherited, not re-implemented.

### Resolvers (in the gateway)

- **status → column:** case-insensitive match of `status` against the board's `KanbanColumn.title`. No match → error listing available column names (agent retries).
- **sprint target:** `current`→ACTIVE sprint; `next`→ next sprint after current by `position` (or earliest PLANNED); `backlog`→`null`; name → case-insensitive `Sprint.name`; else treat as sprintId.
- **task:** id (from a prior `listTasks`/`getTask`) or title match within the board; ambiguous/missing → error with candidates.
- **assignee `me`:** `auth.userId`. **`{person}`:** the agent resolves the name via the existing `listWorkspaceMembers` tool → userId, then passes userId.

## Authorization & scopes

- Authorization is **inherited** from the tRPC procedures (`assertPageAccess` for task/comment ops; `assertPageOwnership` for sprint lifecycle). The engines tools add an upfront `assertMember(ws)` + board-in-workspace guard.
- Scopes: every read tool → `kanban:read`; every write tool → `kanban:write`. Both are **already** in `READ_SCOPES`/`WRITE_SCOPES` in [agents-token.ts](apps/web/src/lib/agents-token.ts) — **no web change required**. Add `kanban:read`/`kanban:write` to the `REQUIRED_READ`/`REQUIRED_WRITE` lists in the `apps/web/test/agents-token.test.ts` drift-guard for completeness.
- `requires_confirmation`: all writes ✔; reads ✗.

## Use-case mapping

- «какие у нас спринты / активный» → `listSprints` / `getActiveSprint`.
- «задачи в спринте X / текущем / у меня / у {человека}» → `listTasks` with `sprint`/`assignee`.
- «передвинь в статус X» → `moveTaskToStatus`. «отмени» → `cancelTask`.
- «назначь/сними меня» → `assignTask`/`unassignTask` (`me`). «у {человека}» → `listWorkspaceMembers` → userId.
- «срок от и до» → `setTaskDates`. «след. спринт / беклог / спринт X» → `setTaskSprint`.
- **UC3:** `createSprint` → `startSprint` → watch via `listTasks(current)` → send back via `moveTaskToStatus` → `addTaskComment` → `closeSprint(moveUndoneTo:'next')`.

## File-by-file changes

**packages/trpc**
- `src/helpers/kanban-caller.ts` — new: `createKanbanCaller` over `router({ kanban: kanbanRouter })`.

**apps/engines** (`src/apps/mcp/`)
- `services/kanban-gateway.service.ts` — new: synthetic-context caller wiring, `mapTrpcError`, resolvers (status/sprint/task), targeted read queries, the board+workspace guard. Injects `PRISMA` + `MarkdownParser`.
- `tools/kanban.tools.ts` — new: the ~15 `@Tool` methods delegating to the gateway.
- `errors/mcp.errors.ts` — add `KanbanError` mappings if needed (or reuse existing `PageNotFoundError` + a generic `TrpcMappedError`).
- `mcp.module.ts` — register `KanbanGateway` + `KanbanTools` (providers; tools in exports).

**apps/agents**
- `apps/agent/services/tool_registry.py` — `DEFAULT_ENGINES_TOOLS` entries for every kanban tool (`kanban:read`/`kanban:write`, confirmation per the table).

**apps/web**
- `test/agents-token.test.ts` — add `kanban:read`/`kanban:write` to the drift-guard required lists (no `agents-token.ts` change — already granted).

## Testing strategy (TDD)

- **engines unit (jest):** mock `KanbanGateway` (or the caller) — assert each tool: resolves status/sprint/task correctly, enforces the workspace+board guard, maps args to the right gateway/caller method, and `mapTrpcError` translates each `TRPCError` code. The intricate kanban business logic is already covered by `@repo/trpc`'s own vitest suite — engines tests cover the **tool + gateway adapter** layer only.
- **engines integration (`test-int`):** one test that drives `KanbanGateway` with a synthetic context against a real (test) DB through `createKanbanCaller` — create a KANBAN page, create a task, move it, assert the `Task.columnId` changed and a `TaskActivity{MOVED}` row was written. Proves the context wiring + reuse end-to-end. (If the integration harness is heavy, a runtime-import smoke test that constructs the caller and lists boards is the minimum.)
- **agents (pytest):** `tool_registry` imports + the new entries' scopes/confirmation.
- **Gate:** `pnpm gates` (sourcing `.env`); the `agents-token` drift-guard must stay green.

## Risks & open questions

1. **`createKanbanCaller` graph safety.** Importing `kanbanRouter` (not `appRouter`) must not transitively load browser-only module-level code. `kanbanRouter` deps are server-safe (prisma, kanban helpers, `kanban-bus` EventEmitter, `page-access`, zod). Validate with a runtime-import smoke test in the integration step; if any import pulls UI, narrow further.
2. **`kanbanBus` cross-process.** Events emit in the engines process; web SSE subscribers won't get live updates from agent-driven changes. Accepted + documented (same as page writes). Not solved here.
3. **`createTask` multi-call.** Creating with assignees/dueDate is `create` + `setAssignees`/`update` (separate caller calls, each its own transaction). Acceptable; not atomic across the three, but each is consistent. If atomicity matters later, add a composite procedure in tRPC.
4. **`assignTask`/`unassignTask` read-modify-write** on `setAssignees` (which takes the full list). Concurrent assignment changes could race; low risk for agent-driven single-user flows.
5. **`yookassa` stub in the context.** Kanban procedures never touch `ctx.yookassa`/`ctx.returnUrlBase`; a throwing stub documents that. If a future kanban procedure references them, the stub throws loudly (good).

## Out of scope / future

- Board-configuration tools (columns/types/priorities/labels CRUD), task numbers, task attachments via MCP, label assignment via MCP (read-only labels shown in `listTasks`/`getTask`), Gantt/timeline-specific tools — revisit per concrete need.
- Cross-process realtime (a shared bus between web and engines) — separate infra concern.
