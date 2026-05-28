# MCP Tooling Expansion — Design

**Status:** Draft, awaiting user review
**Date:** 2026-05-28
**Scope:** Extend the `apps/engines` MCP server (`@rekog/mcp-nest`) with ~20 new tools over **existing** Prisma models — workspaces, page navigation, search, reminders, notifications, favorites, diagram pages — plus fix the broken `search_pages` tool and raise the RAG similarity threshold to `0.7`. Kanban task-management tooling and a page-tag system are **deferred to their own specs**.

## Goal

Let the chat agent (and any external MCP client) drive anynote the way the Obsidian/Notion MCP servers drive their apps, so the four target use cases work end-to-end:

- **UC1 — social post:** ask the agent a question → it drafts a summary in the channel's style → save it as a note from chat → minor edits.
- **UC2 — meeting protocol:** dump rough notes → agent summarizes, extracts owners + deadlines → page is created with due dates and **reminders**.
- **UC4 — conversation → page:** chat about a topic → ask for a summary → save as a page, with the agent **suggesting a parent** from the page tree.

(UC3 — team Kanban — needs the Kanban tools and is handled by a separate spec; see Non-goals.)

The work is almost entirely "write MCP tools over models that already exist." Every model needed (`Reminder`, `NotificationInApp`, `FavoritePage`, the diagram `PageType`s, the page tree) is already in [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma). The exceptions — the `search_pages` embedding fix and the RAG threshold — are small cross-service changes.

## Non-goals

- **Kanban task management (request item 8).** Sprints/tasks/columns/assignees etc. get their own spec/plan cycle. The Kaiten research is captured there. Out of scope here.
- **Page tags + cross-page links/backlinks (request item 4 / UC1 "теги, ссылки").** anynote has **no** page-tag model (only kanban labels) and no editor page-link node. Adding them means a DB migration + UI. Deferred to a future product feature. In this round, "links to similar notes" is achieved by the agent calling the search tools and writing plain markdown links; "tags" by inline `#hashtags` in body text (already covered by Postgres full-text search) — **no new tooling**.
- **Page comments via MCP.** The `PageCommentThread` model exists ([2026-05-24-page-comments-design.md](docs/superpowers/specs/2026-05-24-page-comments-design.md)) but none of UC1–UC4 need agent-driven page comments. Deferred (YAGNI).
- **Obsidian-app-specific capabilities** with no anynote analog: daily/periodic notes, command-palette execution, Templater. Dropped per the "close valuable gaps" parity decision.
- **OAuth / new transports / rate-limiting.** Inherited unchanged from [2026-05-27-public-api-mcp-design.md](docs/superpowers/specs/2026-05-27-public-api-mcp-design.md).
- **Live push to connected editors.** Server-side content writes (diagram create, `appendToPage`) land in `Page.contentYjs`/`content` in the DB; they are not pushed into a live Hocuspocus session. Same limitation the existing `createPage`/`updatePage` tools already have — documented, not solved here.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Parity ambition (item 4) | **Close high-value gaps** only — markdown append, page-tree browse, members, archive/restore. No maximal parity. |
| Reminders (item 2) | **Full CRUD** — add `createReminder` (UC2 needs it) on top of list/move/delete/complete. |
| Diagram validation (item 5) | **Validate where cheap** — return errors to the agent so it can fix & retry. |
| Tags / links (item 4 / UC1) | **Deferred.** |
| Kanban (item 8) | **Deferred** to a separate spec. |
| Tool architecture | **Granular `@Tool` methods** grouped into `*.tools.ts` services — the existing anynote convention; no dispatch/batch meta-tools. |

## Architecture overview

No new services, no new transport. Everything plugs into the existing MCP module.

```
agent (apps/agents, LangGraph)            external MCP client
  builds LangChain tools from              Bearer ank_… key
  discovered MCP tools; injects            (api.anynote.ru/mcp)
  server.workspace_id → workspaceId             │
        │                                       │
        ▼                                       ▼
   apps/engines  POST /mcp  (@rekog/mcp-nest, McpAuthGuard)
   ┌──────────────────────────────────────────────────────┐
   │ tools/                                                 │
   │   workspaces.tools.ts   list_workspaces (+isCurrent)    │
   │   workspace.tools.ts    listWorkspaceMembers           │
   │   page.tools.ts         listPages, appendToPage,       │
   │                         archivePage, restorePage       │
   │   search.tools.ts       search_pages(FIX), searchByTitle│
   │   reminder.tools.ts     create/list/move/delete/complete│  ← new file
   │   notification.tools.ts list/markRead                  │  ← new file
   │   favorite.tools.ts     list/add/remove                │  ← new file
   │   diagram.tools.ts      createDiagramPage, updateSource │  ← new file
   │ services/                                              │
   │   reminder.service.ts, notification.service.ts,        │  ← new
   │   favorite.service.ts, diagram-validator.service.ts,   │  ← new
   │   page-fts.service.ts (Postgres title search)          │  ← new
   │   page-writer.service.ts (+seedDiagram, +appendMarkdown)│  ← extended
   └──────────────────────────────────────────────────────┘
        │ Prisma (@repo/db, main Postgres)      │ fetch AGENTS_URL
        ▼                                       ▼
   Postgres (pages, reminders, …)        apps/agents POST /v1/search
                                          (embedding cfg + score_threshold 0.7)
                                              └─ Qdrant similarity_search
```

### Conventions every new tool follows (matches existing tools)

1. One `@Injectable()` `*.tools.ts` class; each operation is a `@Tool({ name, description, parameters })` method.
2. Input schema built with Zod + the helpers in [apps/engines/src/apps/mcp/utils/mcp-input.ts](apps/engines/src/apps/mcp/utils/mcp-input.ts) (`mcpInput`, `mcpUuid`, `mcpNullableUuidOptional`).
3. Auth: `requireAuth(req)` → `{ userId }`, then `await assertMember(prisma, userId, workspaceId)` ([apps/engines/src/apps/api/auth/membership.ts](apps/engines/src/apps/api/auth/membership.ts)) for any workspace-scoped tool. Per-user tools (favorites, notifications) authorize on `userId` and verify page/workspace membership when a `pageId`/`workspaceId` is involved.
4. `workspaceId` is a tool parameter; `apps/agents` auto-injects it from `server.workspace_id` and strips it from the LLM-visible schema. Tools that operate on "the current workspace" therefore just declare `workspaceId`.
5. Register the class in [apps/engines/src/apps/mcp/mcp.module.ts](apps/engines/src/apps/mcp/mcp.module.ts) `providers` **and** `exports`.
6. Add tool metadata to `DEFAULT_ENGINES_TOOLS` in [apps/agents/agents/apps/agent/services/tool_registry.py](apps/agents/agents/apps/agent/services/tool_registry.py): a `scope` and `requires_confirmation`. New scopes: `reminders:read|write`, `notifications:read|write`, `favorites:read|write`, `workspaces:read`, `members:read`. (`pages:read|write` reused.)
7. Errors use the existing `errors/mcp.errors.ts` classes + global filter so the agent receives a clean, actionable message.

### Confirmation policy (`requires_confirmation`)

- **Require confirmation** (content-creating / destructive / time-shifting): `createReminder`, `moveReminder`, `deleteReminder`, `createDiagramPage`, `updateDiagramSource`, `appendToPage`, `archivePage`, `restorePage`.
- **No confirmation** (read or low-risk personal toggles): all `list*`/`get*`/`search*`, `completeReminder`, `markNotificationsRead`, `addFavorite`, `removeFavorite`.

## Tool inventory

Legend: **C?** = requires confirmation. `ws` = `workspaceId` (auto-injected). Return shapes are JSON; timestamps ISO-8601.

### A. Workspaces & members (item 1, UC2)

| Tool | Params | Behavior | Scope | C? |
|---|---|---|---|---|
| `list_workspaces` *(extend)* | `ws?` (injected) | Existing tool. Add `isCurrent` (== injected `ws`) and `isDefault` (== `UserPreference.defaultWorkspaceId`) to each row. Covers "какие у меня пространства / в каких я состою / где я сейчас". | workspaces:read | — |
| `getWorkspaceStats` *(exists)* | `ws` | Already returns page counts by type + member count. Extend with `reminders` (open count) and `favorites` count. Covers "статистика по пространству X". | workspaces:read | — |
| `listWorkspaceMembers` *(new)* | `ws` | Mirror [workspace.listMembers](packages/trpc/src/routers/workspace.ts) but gate with `assertMember` (any member may read the roster, for owner/assignee resolution). Returns `{ userId, firstName, lastName, email, role }[]`. Lets the agent resolve "{Имя человека}" → userId for UC2 owners. | members:read | — |

### B. Page navigation & editing (parity gaps, UC1/UC4)

| Tool | Params | Behavior | Scope | C? |
|---|---|---|---|---|
| `listPages` *(new)* | `ws`, `parentId?`, `type?`, `query?`, `limit?` | Mirror [pageRouter.listByWorkspace](packages/trpc/src/routers/page.ts) (`archived=false, deletedAt=null`). Returns flat `{ id, title, type, icon, parentId }[]` ordered for tree assembly. `parentId` filters to children of a node; `query` does a cheap title `ILIKE`. This is the agent's map for **UC4 "suggest a parent."** | pages:read | — |
| `appendToPage` *(new)* | `ws`, `pageId`, `markdown` | Append markdown to a **TEXT** page. See "appendToPage semantics" below. UC1 minor edits / UC2 building up a protocol. | pages:write | ✔ |
| `archivePage` *(new)* | `ws`, `pageId` | Set `Page.archived = true` (or `deletedAt` for trash — see open questions). Parity (Notion archive). | pages:write | ✔ |
| `restorePage` *(new)* | `ws`, `pageId` | Inverse of `archivePage`. | pages:write | ✔ |

(Existing `getPageMarkdown`, `getPageStats`, `createPage`, `updatePage`, `movePage` already cover read/create/move.)

### C. Search (items 6 & 7, UC1/UC4)

| Tool | Params | Behavior | Scope | C? |
|---|---|---|---|---|
| `search_pages` *(FIX)* | `ws`, `query`, `k?` | Currently broken — calls `/v1/search` without the required `embedding` config. **Fix:** two-stage like the tRPC search — (1) Postgres FTS title/body search first; (2) if a workspace embedding provider is configured, call `/v1/search` with the embedding config for RAG. Merge/dedupe by `pageId`. Covers "найди по тексту (RAG)". | search:query | — |
| `searchPagesByTitle` *(new)* | `ws`, `query`, `limit?` | Title-only search: Postgres FTS over `search_vector` restricted to the title (and an `ILIKE` fallback), returns ranked candidate pages `{ id, title, type, icon }[]`. Covers "найди страницу с названием X", "на какой странице встречается X" — returns several candidates for the agent to disambiguate. | pages:read | — |

See "Search fix & RAG threshold" for the cross-service detail.

### D. Reminders — full CRUD (item 2, UC2)

Backed by `Reminder` (`pageId, workspaceId, createdById, label, dueAt, offsets[], audience, doneAt, deletedAt`) + `ReminderRecipient`. "My reminders" = `createdById == me` OR I'm in `recipients`. Mutations restricted to reminders I created.

| Tool | Params | Behavior | C? |
|---|---|---|---|
| `createReminder` | `ws`, `pageId`, `dueAt`, `label?`, `audience?`(default ME), `offsets?` | Create a reminder on a page. `assertMember`; verify page ∈ ws. UC2: agent sets a due date per action item. | ✔ |
| `listReminders` | `ws?`, `includeDone?`, `pageId?` | List my reminders (default: pending, current ws). Returns `{ id, label, dueAt, done, page:{id,title}, workspace:{id,name} }[]`. `ws` omitted ⇒ caller's reminders across all workspaces they belong to. Covers "какие у меня напоминания". | — |
| `moveReminder` | `ws`, `reminderId`, **one of** `dueAt` \| `shift:{days?,hours?,minutes?}` | Reschedule. `shift` ⇒ `newDueAt = dueAt + shift`. Covers "сдвинь … на 2 дня / 5 дней / 5 часов". | ✔ |
| `deleteReminder` | `ws`, **one of** `reminderId` \| `reminderIds[]` \| `all:true`(+optional `pageId`) | Soft-delete (`deletedAt`) one, several, or all my reminders. Covers "удалить мои напоминания, все или часть". | ✔ |
| `completeReminder` | `ws`, `reminderId` | Mark done (`doneAt`, `doneById`). | — |

Identification flow (matches Obsidian/Notion fetch→act): the agent calls `listReminders` to get ids + labels, matches "{название}", then calls `moveReminder`/`deleteReminder` by id. No fuzzy server-side name matching.

### E. Notifications (item 3)

Backed by `NotificationInApp` (`userId, readAt`) joined to `NotificationEvent`. Account-wide (not workspace-scoped) — mirrors [notification router](packages/trpc/src/routers/notification.ts). "Unread" = `readAt IS NULL`.

| Tool | Params | Behavior | Scope | C? |
|---|---|---|---|---|
| `listNotifications` | `unreadOnly?`(default true), `limit?` | List the caller's notifications with `{ id, type, category, createdAt, resourceUrl, read }`. Covers "покажи мне уведомления". | notifications:read | — |
| `markNotificationsRead` | **one of** `all:true` \| `ids[]` | Set `readAt`. Mirrors `markAllRead` / `markRead`. Covers "прочитай все уведомления". | notifications:write | — |

### F. Favorites (item 9)

Backed by `FavoritePage` (`userId, pageId, position`, unique `(userId,pageId)`). Per-user; cross-workspace.

| Tool | Params | Behavior | Scope | C? |
|---|---|---|---|---|
| `listFavorites` | `ws?` | List my favorite pages `{ pageId, title, type, icon, workspace }` by `position`. `ws` filters to one workspace. | favorites:read | — |
| `addFavorite` | `ws`, `pageId` | `assertMember`; upsert favorite at `position = max+1`. | favorites:write | — |
| `removeFavorite` | `ws`, `pageId` | Delete the favorite. | favorites:write | — |

### G. Diagram pages (item 5)

| Tool | Params | Behavior | Scope | C? |
|---|---|---|---|---|
| `createDiagramPage` | `ws`, `kind`(MERMAID\|PLANTUML\|LIKEC4), `source`, `title`, `parentId?` | Validate `source` for `kind` (see below); on success create a `Page` of that `type` with `source` seeded into the right `Y.Text`. Returns `{ pageId, url }`. On invalid source, return a structured validation error so the agent fixes & retries. Covers "сформируй … диаграмму, создай страницу". | pages:write | ✔ |
| `updateDiagramSource` | `ws`, `pageId`, `source` | Validate, then re-seed the page's diagram `Y.Text`. | pages:write | ✔ |

One parametrized tool (not three) keeps the surface small; the `kind` enum maps 1:1 to `PageType` + `Y.Text` doc name.

## Search fix & RAG threshold (items 6 & 7)

Three coordinated changes. The reference implementation already exists in tRPC — we mirror it on the MCP side and add the threshold in agents.

**1. Postgres title/body FTS in engines (`page-fts.service.ts`).** Port `searchPg` from [packages/trpc/src/services/page-search.ts:81](packages/trpc/src/services/page-search.ts#L81) (`websearch_to_tsquery` over `search_vector`, `ts_rank` ordering, `deleted_at IS NULL AND archived=false`). `searchPagesByTitle` uses this; `search_pages` uses it as stage 1.

**2. Fix `search_pages` embedding threading.** Mirror `buildEmbedding` / `resolveProviderConnection` from [page-search.ts:153](packages/trpc/src/services/page-search.ts#L153): read `WorkspaceAiSettings` (`embeddingsModel.provider`), reuse the **same secret-decryption util** the workspace-custom-ai-providers feature already uses in engines ([2026-05-28-workspace-custom-ai-providers-design.md](docs/superpowers/specs/2026-05-28-workspace-custom-ai-providers-design.md)) to decrypt `connectionEnc`, and POST `{ workspace_id, query, limit, embedding, score_threshold }` to `/v1/search` via [agents-search.client.ts](apps/engines/src/apps/mcp/services/agents-search.client.ts). If no embedding provider is configured, **skip RAG** and return title results only (graceful — identical to tRPC behavior; never error).

**3. RAG threshold 0.7 in agents.** Add `score_threshold: float = 0.7` to `SearchRequestSchema` ([apps/agents/agents/apps/search/schemas.py](apps/agents/agents/apps/search/schemas.py)), thread it through `rag_retrieval.retrieve()` into `VectorStoreRepository.similarity_search()`, and pass it to `query_points(...)` at [vector_store_repository.py:99](apps/agents/agents/apps/processing/repositories/vector_store_repository.py#L99). Default `0.7` so both MCP and tRPC callers get the higher precision automatically; callers may override.

## Diagram seeding & validation

**Seeding (server-side, Node).** Confirmed `Y.Text` doc names: `mermaid`, `plantuml`, `likec4`. Extend `PageWriter` with `createDiagramPage`:

```ts
import * as Y from 'yjs'
const ydoc = new Y.Doc()
ydoc.getText(docName /* 'mermaid' | 'plantuml' | 'likec4' */).insert(0, source)
const contentYjs = new Uint8Array(Y.encodeStateAsUpdate(ydoc))
// create Page { type, title, parentId, contentYjs, content?, ownership: TEXT, createdById }
```

(Pattern verified in [apps/e2e/plantuml-page.spec.ts](apps/e2e/plantuml-page.spec.ts).) Also enqueue the outbox/indexing event the same way `createPage` does, so the diagram source is searchable. `content` (JSON snapshot) follows the per-type convention in [apps/yjs/src/persistence.ts](apps/yjs/src/persistence.ts) (MERMAID snapshots; PLANTUML/LIKEC4 contentYjs-only).

**Validation (`diagram-validator.service.ts`), "where cheap":**

- **LIKEC4** — real, in-process: `fromSource(source)` then reject if `hasErrors()` (return `getErrors()`). Per memory: `fromSource` never throws, so the `hasErrors()` guard is mandatory.
- **MERMAID** — try `@mermaid-js/parser` if it runs headless in Node; otherwise a structural check (recognized leading diagram keyword: `graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|journey|...`). 
- **PLANTUML** — cheap structural check (`@startuml…@enduml` / `@startmindmap…` pairing balanced). Full server-render validation via the private PlantUML container is **not** done from engines (not cheap) — deferred.

Invalid source ⇒ `DiagramValidationError` with the messages, surfaced to the agent for a fix-and-retry loop (no page created).

## appendToPage semantics

TEXT page content is a Tiptap doc stored in `Page.contentYjs` (Yjs) + `Page.content` (JSON snapshot). `appendToPage`:

1. Load current content as a Tiptap JSON doc (from `content`, or decode `contentYjs`).
2. Parse `markdown` → Tiptap nodes via the existing `MarkdownParser`.
3. Concatenate: `{ type:'doc', content:[...existing.content, ...parsed.content] }`.
4. Regenerate `contentYjs` from the merged JSON via `TiptapTransformer.toYdoc(merged, 'default', EXTENSIONS)` and write `content` + `contentYjs`; enqueue re-index.

**Known limitations (documented, accepted):** full-document regenerate ⇒ last-write-wins; not pushed into a live Hocuspocus session (reflects on next load); fidelity bounded by the markdown↔Tiptap mapping. This matches the existing `updatePage` tool's behavior — we are not regressing, and agent-authored notes are typically not concurrently edited.

## Use-case walkthroughs

- **UC1 (social post):** chat → `createPage(markdown)` → `appendToPage` for tweaks → `searchPagesByTitle`/`search_pages` to find related notes (agent writes plain markdown links to them).
- **UC2 (meeting protocol):** chat → `createPage` with the protocol → `listWorkspaceMembers` to resolve owners → `createReminder` per action item with a `dueAt`. (The existing reminders cron fires `REMINDER_DUE` notifications, surfaced by `listNotifications`.)
- **UC4 (conversation → page):** `listPages` gives the agent the tree → it proposes a `parentId` → `createPage(parentId)`.
- **UC3 (team Kanban):** deferred — Kanban spec.

## File-by-file change list

**apps/engines** (`src/apps/mcp/`)
- `tools/reminder.tools.ts`, `tools/notification.tools.ts`, `tools/favorite.tools.ts`, `tools/diagram.tools.ts` — new tool classes.
- `tools/workspaces.tools.ts` — add `isCurrent`/`isDefault` flags to `list_workspaces` rows.
- `tools/workspace.tools.ts` — `listWorkspaceMembers`; extend `getWorkspaceStats`.
- `tools/page.tools.ts` — `listPages`, `appendToPage`, `archivePage`, `restorePage`.
- `tools/search.tools.ts` — fix `search_pages`; add `searchPagesByTitle`.
- `services/reminder.service.ts`, `notification.service.ts`, `favorite.service.ts`, `diagram-validator.service.ts`, `page-fts.service.ts` — new.
- `services/page-writer.service.ts` — `createDiagramPage`/`seedDiagram`, `appendMarkdown`.
- `services/agents-search.client.ts` — send `embedding` + `score_threshold`.
- `mcp.module.ts` — register new providers/exports.
- `errors/mcp.errors.ts` — `ReminderNotFoundError`, `DiagramValidationError`, etc.

**apps/agents**
- `apps/search/schemas.py` — `score_threshold` (default 0.7).
- `apps/agent/services/rag_retrieval.py`, `apps/processing/repositories/vector_store_repository.py` — thread + apply threshold.
- `apps/agent/services/tool_registry.py` — metadata for every new tool (scope + confirmation).

**Shared:** locate/extract the secret-decryption util so engines can decrypt `WorkspaceAiSettings.connectionEnc` (likely already reachable from the custom-AI-providers work; confirm during planning).

## Testing strategy (TDD)

- **engines unit (jest):** one suite per tool service, mocking Prisma + collaborators — auth/membership enforcement, reminder shift math, delete-all-vs-one, favorite upsert/position, notification mark-read scoping, search two-stage merge + RAG-skip-when-unconfigured.
- **engines integration (`test-int`):** `createDiagramPage` for each kind → decode `contentYjs` → assert the expected `Y.Text` contains the source; validation rejects bad source.
- **agents (pytest):** `similarity_search` passes `score_threshold=0.7`; low-score hits filtered; `SearchRequestSchema` default.
- **e2e (Playwright, optional smoke):** agent-chat creates a reminder / lists workspaces. Note: E2E has no yjs server (per project memory), so diagram *rendering* isn't asserted there — covered by integration instead.
- **Gates:** `pnpm gates` (check-types + lint + build + test) must pass before merge.

## Risks & open questions

1. **`appendToPage` / live editor.** Accepted last-write-wins semantics; flagged. If real-time merge is required later it needs a Hocuspocus-side write path — out of scope.
2. **`archivePage`: `archived` flag vs `deletedAt` (trash).** Proposed: `archivePage` → `archived=true`; a separate trash/delete is not exposed (destructive). Confirm during planning against [2026-04-13-tree-nav-favorites-trash-design.md](docs/superpowers/specs/2026-04-13-tree-nav-favorites-trash-design.md).
3. **Secret-decryption reuse.** Assumes the custom-AI-providers feature exposes a reusable decrypt path in engines; if it's tRPC-only, extract a small shared util. Verify in planning.
4. **Mermaid validation in Node.** If `@mermaid-js/parser` won't run headless, fall back to the structural keyword check (still satisfies "validate where cheap").
5. **Reminder cross-workspace listing.** `listReminders` with no `ws` iterates the caller's memberships — bounded by membership count; fine in practice.
6. **`workspaceId` injection for `list_workspaces`.** To flag `isCurrent`, the tool must receive the injected `ws`; if the Python injector only adds `workspaceId` when present in the schema, declare it optional. `isDefault` (from `UserPreference`) is always available as a fallback.

## Out of scope / future specs

- **Kanban task-management MCP tools** (item 8, UC3) — own spec; Kaiten research reused there: list sprints / active sprint / cards-in-sprint / move-status (column) / assign / dates / next-sprint / backlog / cancel(=archive).
- **Page tags + cross-page links/backlinks** — own product feature (model + UI), then MCP tools.
- **Page comments via MCP**, **daily/periodic notes**, **batch/dispatch meta-tools** — revisit only if a concrete need appears.
