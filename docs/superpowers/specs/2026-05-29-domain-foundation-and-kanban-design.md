# `@repo/domain` Foundation + Kanban (SP1) — Design

**Status:** Draft, awaiting user review
**Date:** 2026-05-29
**Scope:** Create a new NodeNext-clean `@repo/domain` package as the single home for framework-agnostic business logic, migrate the **Kanban** write operations into it, refactor the tRPC kanban procedures to consume it, and build the **Kanban MCP tools** in `apps/engines` on top of it (covering request item 8 + UC3). This is **sub-project 1** of a broader `@repo/domain` initiative; other domains migrate in later cycles.

Supersedes the createCaller-based `2026-05-29-kanban-mcp-tooling-design.md` (that approach hit a toolchain wall — engines `NodeNext` cannot type-check `@repo/trpc`'s `Bundler`-style extensionless source, and better-auth breaks ESM under Jest when the appRouter graph loads).

## Goal

- Stand up `@repo/domain`: a server-safe, dependency-light package (only `@repo/db` + `zod`) that holds business logic as plain functions `(prisma, actorUserId, input) → result`, enforcing authorization and emitting no framework-specific concerns.
- Make Kanban a **single source of truth**: the write logic (transactions, `TaskActivity` audit, fractional positions, single-ACTIVE-sprint invariant, sprint-complete migration, authorization) lives once in `@repo/domain/kanban`; both the tRPC kanban procedures (web/board UI) and the new engines Kanban MCP tools call it.
- Ship the Kanban MCP tools so the chat agent covers item 8 + UC3 («какие спринты / активный / задачи в спринте / у меня / у {человека}», «передвинь в статус», «отмени», «назначь/сними меня», «срок от-до», «след. спринт / беклог / в спринт X», UC3 start/close sprint + comment).

## Non-goals

- **Migrating other domains** (reminders, favorites, notifications, pages, search) into `@repo/domain` — later sub-projects. Only Kanban moves now.
- **Moving kanban READS into the domain.** SP1 moves the intricate, drift-prone **write** logic + authz + helpers. Reads stay where they are: tRPC keeps `getBoard`/`getActivity`; engines does direct Prisma read queries. (Reads are simple selects, low drift risk; they can migrate later.)
- **Refactoring tRPC kanban procedures that have no engines counterpart** (e.g. `task.setLabels`/`softDelete`/`unarchive`, `sprint.update`/`reorder`/`delete`, `comment.update`/`delete`). Those exist only in tRPC → no duplication → leave them. Only the procedures whose logic engines also needs get migrated + thinned.
- **Board-config CRUD** (columns/types/priorities/labels) and **human-readable task numbers** — out of scope (identify tasks by title→id, as before).
- **Realtime live-push** from engines — engines writes don't emit to the web `kanbanBus` (separate process); documented, accepted.
- **A "default board"** — the agent resolves the board (auto if one KANBAN page, else explicit `boardPageId`).

## Decisions

| Decision | Choice |
|---|---|
| Reuse mechanism | **Shared `@repo/domain` functions** (not createCaller, not duplicated logic) |
| `@repo/domain` deps | `@repo/db` + `zod` only — no `@repo/auth`/`@repo/ui`/`@trpc/server` (server-safe, engines-consumable, NodeNext-clean with explicit `.ts` extensions) |
| Errors | Domain throws `DomainError { code, httpStatus, message }`; tRPC maps → `TRPCError`, engines maps → `HttpException` |
| Authorization | Lives in the domain (`assertPageAccess`/`assertPageOwnership` querying Prisma), so it's single-source too |
| Events (`kanbanBus`) | Domain returns data and emits nothing; **callers** emit (tRPC → `kanbanBus`; engines → none) |
| SP1 domain surface | Kanban **writes** + authz + position/activity helpers. Reads stay in consumers. |
| Board / status / sprint / assignee resolution | Lives in the **engines MCP adapter** (NL-friendly), not the domain (domain takes resolved ids) |

## `@repo/domain` package

`packages/domain/` — mirrors `@repo/db`'s setup exactly:
- `package.json`: `"name": "@repo/domain"`, `"type": "module"`, `"private": true`, `exports` `"."`→`./src/index.ts` and `"./*"`→`./src/*`, scripts `build`/`check-types`/`test` (vitest). Deps: `@repo/db` (workspace), `zod`, `@repo/typescript-config` (workspace). Dev: `typescript`, `vitest`, `@types/node`.
- `tsconfig.json`: extends `@repo/typescript-config/base.json` (NodeNext + `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` + `skipLibCheck`), `outDir: dist`, `rootDir: src`, `include: ["src"]`. **All relative imports use explicit `.ts` extensions** (like `@repo/db`) so NodeNext consumers (engines) type-check it cleanly.

Structure:
```
packages/domain/src/
  errors.ts            // DomainError + helpers (notFound/forbidden/badRequest/conflict)
  index.ts             // re-exports errors + kanban
  kanban/
    index.ts           // re-export kanban surface
    access.ts          // assertPageAccess / assertPageOwnership (DomainError)
    helpers.ts         // positionBetween / endPosition / recordActivity (moved from @repo/trpc kanban helpers)
    schemas.ts         // zod input schemas (shared by tRPC .input and as the typed contract)
    tasks.ts           // createTask, updateTask, moveTask, setTaskAssignees, archiveTask
    sprints.ts         // createSprint, activateSprint, completeSprint
    comments.ts        // createTaskComment
```

### `DomainError` (`errors.ts`)
```ts
export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus: number) {
    super(message)
    this.name = 'DomainError'
  }
}
export const notFound = (m: string) => new DomainError('NOT_FOUND', m, 404)
export const forbidden = (m: string) => new DomainError('FORBIDDEN', m, 403)
export const badRequest = (m: string) => new DomainError('BAD_REQUEST', m, 400)
export const conflict = (m: string) => new DomainError('CONFLICT', m, 409)
export function isDomainError(e: unknown): e is DomainError {
  return e instanceof Error && e.name === 'DomainError'
}
```

### Kanban domain functions
Signature: `fn(prisma: PrismaClient, actorUserId: string, input: <typed>) → Promise<Result>`. Each runs `prisma.$transaction`, writes `TaskActivity` via `recordActivity`, and enforces authz at the top (`assertPageAccess` for task/comment ops, `assertPageOwnership` for sprint ops) — **byte-for-byte the logic currently in the tRPC procedures**, with `TRPCError` → `DomainError` and `ctx.user.id` → `actorUserId`, and the trailing `kanbanBus.emit(...)` removed (callers emit). Functions return the same shapes the procedures returned (e.g. `createTask` → the `Task`).

Surface (exactly the operations engines needs, so both consumers share them):
- `createTask`, `updateTask`, `moveTask`, `setTaskAssignees`, `archiveTask`
- `createSprint`, `activateSprint`, `completeSprint`
- `createTaskComment`
- helpers `positionBetween`/`endPosition`/`recordActivity`; authz `assertPageAccess`/`assertPageOwnership`; zod schemas for each input.

`access.ts` ports `assertPageAccess`/`assertPageOwnership` from [packages/trpc/src/helpers/page-access.ts](packages/trpc/src/helpers/page-access.ts) (same Prisma queries) but throws `DomainError` and takes `(prisma, userId, pageId)`.

## tRPC refactor (web/board UI consumer)

The migrated procedures in `packages/trpc/src/routers/kanban/{task,sprint,comment}.ts` become **thin wrappers**:
```ts
create: protectedProcedure
  .input(kanbanCreateTaskInput)            // reuse the domain zod schema
  .mutation(async ({ ctx, input }) => {
    const task = await mapDomain(() => domainCreateTask(ctx.prisma, ctx.user.id, input))
    kanbanBus.emit(input.pageId, { kind: 'task.created', taskId: task.id })
    return task
  }),
```
- A small `mapDomain(fn)` helper in `@repo/trpc` translates `DomainError` → `TRPCError` (by `httpStatus`/`code`).
- `kanbanBus` emits stay in the procedures (unchanged events).
- Non-migrated procedures (labels/softDelete/unarchive/sprint.update/reorder/delete/comment.update/delete) are untouched.
- The existing `@repo/trpc` kanban vitest suite + the board UI must continue to pass unchanged — this is the regression guard for the refactor.

## engines consumption (Kanban MCP tools)

`apps/engines/src/apps/mcp/`:
- `services/kanban-gateway.service.ts` — NL-friendly **resolvers** + the board guard + a `DomainError`→`HttpException` mapper. NO `@repo/trpc` import, NO createCaller.
  - `assertBoard(userId, ws, boardPageId)` (KANBAN page in ws, member), `resolveBoardPageId(userId, ws, boardPageId?)` (auto if single), `resolveColumnByStatus`, `findCancelColumn`, `resolveSprintTarget`, `resolveTypeByName`, `resolvePriorityByName`, `resolveAssignee`, `currentAssigneeIds`, and `run(fn)` mapping `DomainError`→`HttpException`.
- `services/kanban-read.service.ts` — direct Prisma reads (boards/sprints/active/tasks/getTask), as in the prior plan.
- `services/kanban-write.service.ts` — calls `@repo/domain` kanban functions (resolving NL inputs → ids first), e.g. `moveTaskToStatus` → resolve status→columnId → `domainMoveTask(prisma, userId, {pageId, id, targetColumnId, beforeId:null, afterId:null})` wrapped in `gateway.run`.
- `tools/kanban.tools.ts` — the ~18 thin `@Tool` methods (reads + writes), `requireAuth` → service. Registered in `mcp.module.ts`; `kanban:read`/`kanban:write` entries in `apps/agents` `tool_registry.py` (scopes already granted in `agents-token.ts`).

engines gets `@repo/domain` as a new workspace dependency. Because `@repo/domain` is NodeNext-clean (explicit `.ts` extensions, no auth/UI deps), engines type-checks + loads it without the `@repo/trpc` toolchain problems.

## Tool inventory (~18) and use-case mapping

Unchanged from the prior kanban spec (only the *implementation* of writes changed — now via `@repo/domain` instead of createCaller):
- Reads: `listKanbanBoards`, `listSprints`, `getActiveSprint`, `listTasks` (sprint/assignee/status filters), `getTask`.
- Writes: `createTask`, `moveTaskToStatus`, `assignTask`/`unassignTask`, `setTaskDates`, `setTaskSprint`, `setTaskPriority`/`setTaskType`, `cancelTask` (CANCELLED column else archive), `addTaskComment`, `createSprint`, `startSprint`, `closeSprint`.
- Mapping: «спринты/активный»→`listSprints`/`getActiveSprint`; «задачи в спринте/текущем/у меня/у {человека}»→`listTasks`; «в статус X»→`moveTaskToStatus`; «отмени»→`cancelTask`; «назначь/сними»→`assign`/`unassign`; «срок от-до»→`setTaskDates`; «след/беклог/спринт X»→`setTaskSprint`; UC3→`createSprint`/`startSprint`/`listTasks`/`moveTaskToStatus`/`addTaskComment`/`closeSprint`.

## Authorization & scopes

- Authz is enforced in the **domain** (membership for tasks/comments, creator-or-OWNER for sprints) → identical for both consumers. engines additionally guards board-in-workspace.
- Scopes `kanban:read`/`kanban:write` are **already granted** in [agents-token.ts](apps/web/src/lib/agents-token.ts) — no web change beyond adding them to the `apps/web/test/agents-token.test.ts` drift-guard. Registry entries (scope + confirmation: writes ✔, reads ✗) added in `tool_registry.py`.

## Testing strategy (TDD)

- **`@repo/domain` (vitest):** the heart of the testing — unit-test each kanban write function against a mocked/in-memory Prisma (or a test DB) for: authz (member/owner), position math, `TaskActivity` rows written, single-active-sprint, sprint-complete migration. This is where the intricate logic is verified once.
- **`@repo/trpc` kanban suite:** must keep passing unchanged after the refactor (regression guard that the thin wrappers preserve behavior). Add a `mapDomain` test.
- **engines (jest):** gateway resolvers (mocked Prisma); read service (mocked Prisma); write service (mock the domain functions — assert NL resolution + arg mapping + `DomainError`→`HttpException`); thin tools (mock services). 
- **Integration:** one engines `test-int` that runs a write service method end-to-end against a test DB through `@repo/domain` (create board+task, move it, assert `columnId` + `TaskActivity{MOVED}`), proving the engines→domain path.
- **Gate:** `pnpm gates`; `@repo/domain` must be built before consumers type-check (turbo `^build` handles ordering since engines/trpc depend on `@repo/domain`).

## Risks & open questions

1. **tRPC refactor must preserve board behavior.** The kanban UI + the existing `@repo/trpc` kanban tests are the guard. Migrate one procedure at a time; keep returns + emitted events identical. If any behavior is hard to preserve, stop and reassess that procedure.
2. **Authz duplication (temporary).** `@repo/domain/kanban/access.ts` re-creates `assertPageAccess`/`assertPageOwnership`; `@repo/trpc`'s `helpers/page-access.ts` stays for non-migrated routers. Two small copies until a later SP unifies page-access into the domain. Acceptable + noted.
3. **`recordActivity`/position helpers move** from `@repo/trpc/src/routers/kanban/helpers.ts` to `@repo/domain`. The tRPC kanban routers that still use them (non-migrated procedures: `column`/`type`/`priority`/`label`/`sprint.reorder`) must import them from `@repo/domain` (or `@repo/trpc` re-exports from `@repo/domain`). Plan: `@repo/trpc` kanban `helpers.ts` re-exports the moved helpers from `@repo/domain` so non-migrated routers keep working with no churn.
4. **Domain transaction boundaries.** Each domain function owns its `$transaction`. `createTask`-with-assignees in engines is still 2 domain calls (create + setTaskAssignees) — non-atomic across them, as before; acceptable.
5. **realtime** (engines no live-push) — accepted, documented.

## Out of scope / future sub-projects

- SP2: migrate Notifications + Favorites + Reminders into `@repo/domain` (de-dup the feature-1 engines services against the tRPC routers).
- SP3: Pages/Search + unify `page-access` into the domain (resolve risk #2).
- Board-config CRUD, task numbers, page comments via MCP, cross-process realtime — as needed later.
