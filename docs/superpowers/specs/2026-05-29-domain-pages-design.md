# `@repo/domain` SP3 — Pages write logic — Design

**Status:** Draft, awaiting user review
**Date:** 2026-05-29
**Scope:** Migrate the **Pages** write business-logic (the 10 mutating tRPC `page` procedures) into `@repo/domain` (a new `pages/` module), and refactor **both** consumers — the `@repo/trpc` `page` router and the `apps/engines` page-writer service — to call it. This is **sub-project 3** of the `@repo/domain` initiative (see `[[domain-package-initiative]]`), executed as a **single cycle** covering all of Pages. **Search is out of scope** (read-dominant: RAG lives in `apps/agents`/Python; the tRPC `search` router is queries + trivial user-preference history writes — no page write-logic to migrate). Favorites already moved out of `page.ts` in SP2.

---

## Context

SP1 created `@repo/domain` + migrated Kanban; SP2 migrated Notifications/Favorites/Reminders and introduced the **Ports** pattern for transactional side-effects that live in a Bundler-resolution package. SP3 migrates **Pages** — the largest domain — following the same `fn(prisma, actorUserId, input)` / `DomainError` / domain-owns-`$transaction` contract.

Two findings shape this cycle:

1. **The outbox enqueue is simpler than reminders' scheduler.** `enqueueOutboxEvent(tx, { eventType, aggregateType, aggregateId, workspaceId, payload? })` lives in **`@repo/db`** (NodeNext-clean, already a `@repo/domain` dependency) and is a pure in-transaction DB write. So the page domain functions **import and call it directly** inside their `$transaction` — **no Port needed** (the reminders complication does not recur). Page events: `page.upserted` (create/rename/update/move/reorder/duplicate/restore) and `page.deleted` (softDelete/hardDelete/emptyTrash).

2. **The engines page surface diverges from tRPC, with two latent gaps.** The engines `page-writer.service.ts` `createPage` inserts a page with **no linked-list position** (engines-created pages aren't ordered), and `movePage` has **no cycle-detection**. tRPC has both. Routing the engines shared operations through the domain **fixes both gaps** — the analog of SP2's reminders-delivery bug fix.

## Principles (inherited; one note)

- Domain functions: `fn(prisma, actorUserId, input)`, validate via exported `zod` schemas, access-check first, throw `DomainError { code, httpStatus, message }`, own their `prisma.$transaction`. Deps stay `@repo/db` + `zod` only; explicit `.ts` import extensions.
- **Transactional side-effects:** the outbox enqueue is a pure `@repo/db` write, so it is **imported directly** (not an injected Port — that pattern is reserved for side-effects living in Bundler-resolution packages, as with SP2 reminders). In-process fire-and-forget events remain a caller concern (Pages has none today).

## Pages write surface (10 mutations, ~555 LOC, 3 clusters)

| Cluster | Domain fn | tRPC source | Notes |
|---|---|---|---|
| **Core CRUD** | `createPage` | `page.create` | list-tail insert (`prevPageId`), `seedKanbanDefaults` when `type==='KANBAN'`, `page.upserted` |
| | `renamePage` | `page.rename` | title/icon, `page.upserted` |
| | `updatePage` | `page.update` | title/icon/type, `page.upserted` |
| | `duplicatePage` | `page.duplicate` | copy `content` + `contentYjs`, insert after original, relink, `page.upserted` |
| **Move/Reorder** | `movePage` | `page.move` | reparent, cycle-detection (ancestor walk), detach old list + relink, `page.upserted` |
| | `reorderPage` | `page.reorder` | parentId+prevPageId, BFS cycle-detection, 3-step relink, `page.upserted` |
| **Trash** | `softDeletePage` | `page.softDelete` | recursive BFS soft-delete of descendants, unlink, `page.deleted` |
| | `restorePage` | `page.restore` | restore page + descendants (handle deleted-parent → root), relink, `page.upserted` |
| | `hardDeletePage` | `page.hardDelete` | delete + unlink (cascade), `page.deleted` |
| | `emptyTrash` | `page.emptyTrash` | batch hard-delete trashed pages, `page.deleted` per page |

Reads (`listTrashed`/`listByWorkspace`/`getById`/`listFavorites`) and the favorite procedures (SP2) stay where they are.

### New domain helpers

- `domain/pages/ordering.ts` — the linked-list relink primitives (detach, insert-at-tail, insert-after, relink) + **cycle-detection** (ancestor walk for `move`; BFS for `reorder`/descendant ops). Ported verbatim from `page.ts`.
- `domain/kanban/seed.ts` — **`seedKanbanDefaults` moves here** (it's pure Prisma writes seeding columns/types/priorities; currently in `@repo/trpc/src/routers/kanban/helpers.ts` which the domain can't import). `domain.createPage` calls it for KANBAN pages. Its sole caller (`page.create`) becomes the domain function.
- Access: `assertPageAccess` / `assertPageOwnership` already in `domain/kanban/access.ts` (SP1) — reused.

## Consumer wiring

- **tRPC** (`packages/trpc/src/routers/page.ts`): the 10 procedures become thin `mapDomain(() => domain.<fn>(ctx.prisma, ctx.user.id, input))` wrappers, **keeping** their existing pre-checks (`requireWritableWorkspace` / `assertWorkspaceMember` — the billing/plan gate stays a caller concern, as with favorites in SP2). Reads + favorites untouched.
- **engines** (`apps/engines/src/apps/mcp/services/page-writer.service.ts`): the two genuinely-shared operations — `createPage` and `movePage` — **delegate to the domain**, unifying behavior and fixing the two gaps (list-positioning on create, cycle-detection on move). MCP tool input contracts are unchanged (the tool schemas govern what the agent passes; the service adapts return shapes as needed, as in SP2). `movePage` maps to the domain ordering fn that matches its `prevPageId` semantics (closer to tRPC `reorder` than `move`) — the plan pins the exact mapping.
- **engines-only writes stay direct-Prisma** (no tRPC counterpart / different operation / content-format specifics; they already enqueue outbox correctly — same rationale as keeping `setPreference` in tRPC for SP2):
  - `updatePage` — engines updates title/icon/**content** (Tiptap/`contentYjs` rebuild), whereas tRPC `update` changes title/icon/**type**; they are different operations sharing a name, so engines `updatePage` is NOT unified onto `domain.updatePage`.
  - `appendToPage` (Tiptap append), `createDiagramPage` / `updateDiagramSource` (MERMAID/PLANTUML/LIKEC4 + `contentYjs`).
  - `setArchived` / `archivePage` / `restorePage` — engines toggles the `archived` **flag**, a different feature from tRPC's `deletedAt`-based trash lifecycle.

## Error mapping & scopes

Reuse `mapDomain` (tRPC → `TRPCError`). engines services throw `DomainError` directly (mcp-nest surfaces it identically to `HttpException` — verified in SP2). Page scopes (`pages:read` / `pages:write` / `pages:delete`) are already granted in `agents-token.ts` + drift-guarded. **No new scopes, no new MCP tools.**

## Testing

- **Domain unit tests** per function (mocked Prisma), with focused coverage of the riskiest branches: `move`/`reorder` **cycle-detection** (reject a move into own descendant) and `softDelete`/`restore` **recursive BFS** over descendants.
- **tRPC `page-router` regression suite** is the primary guard — the ports are verbatim, so behavior/messages must match. Keep green.
- **engines page-writer tests** — real-domain + mocked-Prisma (the SP2 pattern); update specs to reflect delegation (engines `createPage` now positions; `movePage` now cycle-checks).
- **Capstone integration test** (live Postgres): engines `createPage` → domain → assert the page lands **in the linked list** (has a `prevPageId`/tail position) **and** a `page.upserted` `outbox_events` row exists — proving the engines gap-fix end-to-end.

## Risks

- **Highest fidelity risk:** the `move`/`reorder` linked-list pointer algebra + cycle-detection and the recursive `softDelete`/`restore` tree walks. Mitigation: port verbatim, dedicated domain unit tests for the tree/cycle branches, and the tRPC regression suite.
- **Engines behavior change:** unifying `createPage`/`movePage` onto the domain adds list-positioning + cycle-detection to the MCP agent's page operations. Treated as gap-fixes (improvements), validated by the capstone integration test.
- **`seedKanbanDefaults` move:** ensure the relocation to `@repo/domain` doesn't break the tRPC kanban router (verify `page.create` is the only caller; the kanban board/column routers seed via this same path).

## Build order (single cycle)

1. **Cluster A foundation** — `domain/pages` scaffold + `ordering.ts` helpers + move `seedKanbanDefaults` into `domain/kanban/seed.ts` + `createPage`/`renamePage`/`updatePage`/`duplicatePage` + tests.
2. **Cluster B** — `movePage`/`reorderPage` (cycle-detection) + tests.
3. **Cluster C** — `softDeletePage`/`restorePage`/`hardDeletePage`/`emptyTrash` + tests.
4. **tRPC wiring** — the 10 procedures → wrappers (keep pre-checks); regression suite green.
5. **engines wiring** — `createPage`/`updatePage`/`movePage` delegate (gap-fixes); engines-only writes untouched; engines tests.
6. **Verify** — capstone integration test, full `pnpm gates`, drift-guard unchanged (no new scopes), mark spec Implemented.

## Out of scope

- **Search** (read-only; RAG in `apps/agents`; trivial history writes are user-preference, not page logic).
- engines-only page writes (`append`/diagram/`setArchived`) — stay direct-Prisma.
- Any new MCP tool, scope, or change to page-share (`pageShare`) logic.
- Block model / content-format changes (`contentYjs` is copied as opaque bytes in `duplicate`, untouched).
