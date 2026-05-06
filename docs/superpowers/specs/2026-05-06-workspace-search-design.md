---
status: approved
date: 2026-05-06
topic: Workspace-wide page search (sidebar entry, modal, postgres FTS, qdrant fallback)
---

# Workspace-wide Page Search — Design

## Goal

Add an end-to-end search experience inside `/workspaces/[workspaceId]`:

1. A "Поиск" entry at the top of the workspace sidebar.
2. A modal command-palette-style dialog opened by sidebar click or `Cmd+K` / `Alt+K`.
3. The dialog runs a Postgres full-text search and a Qdrant vector search **in parallel**.
   If the Postgres branch returns any rows, only Postgres results are shown; otherwise the
   vector results are shown.
4. Results carry `pageId`, `title`, `blockNumber`, and a text excerpt. Clicking a result
   navigates to `/workspaces/{ws}/pages/{page}#{blockNumber}` and the existing block-anchor
   highlight (`block-anchor.ts`, 3 s yellow flash) handles scroll + flash.
5. With an empty query, the dialog shows a "Ранее искали" section listing the 5 most
   recently visited pages from search results, with per-row "favorite" and "remove from
   history" affordances.
6. Clicking any result records a search-history entry for the user/workspace/page tuple.

## Non-goals

- Hybrid BM25 + vector reranking.
- Cross-workspace search.
- Search over files (S3/MinIO) or chats; only `Page` rows.
- Block-level chunk-id anchoring for Qdrant results — Qdrant already stores
  `blockNumber` per chunk, which is enough for the existing scroll-to-block mechanism.
  Per-chunk highlighting inside a block is out of scope.
- Keyboard navigation between result items via ↑/↓/Enter (can be added later).

## Current state (summary)

- Sidebar lives in `apps/web/src/components/workspace/workspace-sidebar.tsx` and renders,
  in order: workspace switcher, `<SearchSidebarSection />` (AI chats list, line 156),
  `<NavItem>` settings (157–163), `<FavoritesSection />`, `<PageTreeSection />`, divider,
  trash. The new "Поиск" must sit above `<SearchSidebarSection />`.
- Page model (`packages/db/prisma/schema.prisma`) has `title`, `content` (Tiptap JSON
  snapshot), `contentYjs` (authoritative bytes), `archived`, `deletedAt`. There is **no**
  block model; "blocks" are top-level Tiptap nodes addressed by integer index.
- Block-anchor highlight already exists. URL fragment `#<index>` triggers
  `scrollToBlockIndex(editor, index)` in `packages/editor/src/block-anchor.ts`, which
  scrolls and flashes for 3000 ms via the `block-flash` class on
  `[data-block-index="..."]`.
- `apps/web` has no full-text search procedure today. `page.listByWorkspace` returns the
  full tree and the renderer filters by title client-side.
- `apps/agents` indexes `Page.content` chunked by `RecursiveCharacterTextSplitter`
  (`chunk_size=500`, `chunk_overlap=100`). Each Qdrant point payload carries
  `{ pageId, workspaceId, title, pageType, blockNumber, content }`. Collection name is
  `pages_{provider_slug}_{model_slug}` (model-keyed, multi-workspace).
- `RagRetrievalService` runs Qdrant similarity search with workspace filter and dedupe by
  `(pageId, blockNumber)`. It is only invoked from the LangGraph chat node — **no HTTP
  endpoint exposes it**.
- `FavoritePage` model and `page.addFavorite` / `page.removeFavorite` / `page.listFavorites`
  procedures exist and will be reused as-is.
- No global hotkey system exists. No `SearchHistory` model exists.
- Plan flag `pageIndexingEnabled` exists; without it, indexing does not run, so vector
  search has no data.

## Approach

Three options were considered:

- **A. One tRPC procedure orchestrates both branches server-side.** `Promise.allSettled`
  on Postgres + Qdrant; if Postgres returned rows, return Postgres; otherwise return
  Qdrant. Simple client, single round-trip. **Chosen.**
- B. tRPC subscription streams progressive results.
- C. Two separate procedures, client merges.

A is chosen because the merge rule ("Postgres wins if non-empty") is a server-side
invariant, the simplest contract for the client, and a single round-trip latency is
bounded by `max(t_pg, t_qdrant)` with a 5 s qdrant timeout.

## Architecture

```
browser
  └─ trpc.search.search({ workspaceId, query })
       │
       ├── Promise.allSettled:
       │     ├── searchPg(workspaceId, query)        → Postgres FTS
       │     │     ├── tsvector @@ websearch_to_tsquery('russian', query)
       │     │     └── walk Page.content JSON to find blockNumber + excerpt
       │     │
       │     └── searchQdrant(workspaceId, query)    → apps/agents
       │           ├── load workspace AI settings + plan
       │           ├── if !embedding || !pageIndexingEnabled → return []
       │           └── POST AGENTS_SERVICE_URL/v1/search
       │                 └── apps/agents wraps RagRetrievalService.run(...)
       │                       └── Qdrant similarity_search (workspaceId filter, dedupe)
       │
       └── if pg.length > 0 → return pg, else return qdrant (or [] if both failed)
```

Search history and favorites are independent procedures triggered by clicks in the dialog.

## Section 1: Database schema

### 1.1 `Page.searchVector` — generated tsvector

Prisma cannot model tsvector directly; use `Unsupported` plus a raw SQL migration.

```prisma
model Page {
  // ...existing fields
  searchVector  Unsupported("tsvector")?

  @@index([searchVector], type: Gin, name: "Page_searchVector_idx")
}
```

Migration SQL (in the Prisma migration's `migration.sql`):

```sql
ALTER TABLE "Page" ADD COLUMN "searchVector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
  setweight(jsonb_to_tsvector('russian', coalesce(content, '{}'::jsonb), '["string"]'), 'B')
) STORED;

CREATE INDEX "Page_searchVector_idx" ON "Page" USING GIN ("searchVector");
```

Rationale:

- `setweight(..., 'A')` on title and `'B'` on content tilts ranking toward title hits.
- `jsonb_to_tsvector(..., '["string"]')` extracts every string literal from the Tiptap
  JSON snapshot — equivalent to concatenating the text of every Tiptap text node, with no
  application-side maintenance.
- `'russian'` text-search configuration is the default for primarily-Russian content.
  English words still match (as unstemmed lexemes). If mixed-locale corpora become a
  problem, swap to a custom configuration that combines `russian` and `english` snowball
  dictionaries.
- Generated `STORED` columns recompute automatically on `INSERT`/`UPDATE` to `title` or
  `content`, so indexing keeps up with snapshot writes from the editor.

### 1.2 `SearchHistory` model

```prisma
model SearchHistory {
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @db.Uuid
  workspaceId    String   @db.Uuid
  pageId         String   @db.Uuid
  lastVisitedAt  DateTime @default(now())

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  page      Page      @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId, pageId])
  @@index([userId, workspaceId, lastVisitedAt(sort: Desc)])
}
```

Add reciprocal relation arrays to `User`, `Workspace`, `Page`. Soft-delete (`Page.deletedAt`)
does not cascade — the list query already filters by `Page.deletedAt IS NULL`.

`history.add` uses `prisma.searchHistory.upsert` keyed on the unique tuple, setting
`lastVisitedAt = now()` on conflict. After upsert, prune by deleting any rows for this
`(userId, workspaceId)` outside the top 20 by `lastVisitedAt DESC`. Display layer
slices to 5.

## Section 2: Backend

### 2.1 New endpoint in `apps/agents`: `POST /v1/search`

Module: `apps/agents/agents/apps/search/` (new), router mounted in `agents/main.py` like
`processing/router.py`.

Request schema (Pydantic):

```python
class SearchRequestSchema(BaseModel):
    workspaceId: UUID
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=50)
    embedding: EmbeddingConfigSchema  # reused from processing/schemas.py
```

Response schema:

```python
class SearchResultSchema(BaseModel):
    pageId: UUID
    title: str
    blockNumber: int
    content: str
    score: float

class SearchResponseSchema(BaseModel):
    results: list[SearchResultSchema]
```

Handler is a thin wrapper over the existing components:

1. Build the embedding instance via `EmbeddingFactoryRepository.make(embedding)`.
2. Resolve collection name via `processing.utils.collection_name(provider_slug, model_slug)`.
3. Call `VectorStoreRepository.similarity_search(query, collection, workspaceId, k=limit)`
   with score threshold `0.4` (constant in module; align with chat retrieval threshold).
4. Dedupe by `(pageId, blockNumber)` keeping the best-scoring chunk (mirrors
   `RagRetrievalService._dedupe`).
5. Map to `SearchResultSchema`.

If the resolved collection does not exist (workspace has never been indexed), return
`{ "results": [] }` with HTTP 200 — not an error.

### 2.2 New tRPC router `packages/trpc/src/routers/search.ts`

```ts
search.search       ({ workspaceId, query }: { workspaceId: string; query: string })
                       → SearchResultItem[]
search.history.list ({ workspaceId })  → HistoryItem[]   // top 5 by lastVisitedAt desc
search.history.add  ({ workspaceId, pageId })  → void    // upsert + prune to 20
search.history.remove({ workspaceId, pageId }) → void
```

Types:

```ts
type SearchResultItem = {
  pageId: string
  title: string
  icon: string | null
  blockNumber: number | null // null for non-TEXT pages or title-only matches
  excerpt: string | null // null for non-TEXT pages or title-only matches
  source: 'postgres' | 'qdrant'
}

type HistoryItem = {
  pageId: string
  title: string
  icon: string | null
  isFavorite: boolean
}
```

All procedures are `protectedProcedure` and reuse the workspace-membership assertion
helper used in `page.ts` (look up `WorkspaceMember` for `(userId, workspaceId)`).

The router is mounted in `packages/trpc/src/index.ts` under `appRouter.search`.

### 2.3 Postgres branch — `searchPg`

Lives in `packages/trpc/src/services/page-search.ts` so it can be unit-tested without a
tRPC harness.

```ts
export async function searchPg(
  prisma: PrismaClient,
  workspaceId: string,
  rawQuery: string,
): Promise<SearchResultItem[]> {
  const query = rawQuery.trim().slice(0, 200)
  if (query.length < 2) return []

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      title: string | null
      icon: string | null
      content: Prisma.JsonValue | null
      type: string
    }>
  >`
    SELECT id, title, icon, content, type
    FROM "Page"
    WHERE "workspaceId" = ${workspaceId}::uuid
      AND "deletedAt" IS NULL
      AND "archived" = false
      AND "searchVector" @@ websearch_to_tsquery('russian', ${query})
    ORDER BY ts_rank("searchVector", websearch_to_tsquery('russian', ${query})) DESC
    LIMIT 10
  `

  return rows.map((row) => {
    if (row.type !== 'TEXT' || !row.content) {
      return {
        pageId: row.id,
        title: row.title ?? '',
        icon: row.icon,
        blockNumber: null,
        excerpt: null,
        source: 'postgres',
      }
    }
    const hit = findFirstMatchingBlock(row.content, query)
    return {
      pageId: row.id,
      title: row.title ?? '',
      icon: row.icon,
      blockNumber: hit?.blockNumber ?? null,
      excerpt: hit?.excerpt ?? null,
      source: 'postgres',
    }
  })
}
```

Helpers in the same module:

- `findFirstMatchingBlock(content: Tiptap JSON, query: string) → { blockNumber, excerpt } | null`
  iterates `doc.content[]` and recursively concatenates `text` nodes per top-level child,
  returns the index + a ±100 char window around the first case-insensitive match.
- `extractExcerpt(blockText, query, window=100)` carves the substring; replacement of
  newlines with spaces; ellipsis on either side if truncated.

### 2.4 Qdrant branch — `searchQdrant`

Lives in `packages/trpc/src/services/page-search.ts`. Loads workspace AI settings the
same way `apps/web/src/app/api/agents/generate/route.ts` does (via the existing AI
settings helper — exact symbol resolved at implementation time, the convention is
`getWorkspaceAiSettings(workspaceId)` returning `{ embedding: { provider, modelSlug,
vectorSize, connection } | null }`).

```ts
export async function searchQdrant(
  prisma: PrismaClient,
  workspaceId: string,
  query: string,
): Promise<SearchResultItem[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const ai = await getWorkspaceAiSettings(prisma, workspaceId)
  const plan = await getWorkspacePlan(prisma, workspaceId)
  if (!ai?.embedding || !plan.pageIndexingEnabled) return []

  try {
    const res = await fetch(`${process.env.AGENTS_SERVICE_URL}/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
      body: JSON.stringify({
        workspaceId,
        query: trimmed,
        limit: 10,
        embedding: ai.embedding,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      results: Array<{ pageId: string; title: string; blockNumber: number; content: string }>
    }
    const ids = data.results.map((r) => r.pageId)
    const pages = await prisma.page.findMany({
      where: {
        id: { in: ids },
        workspaceId,
        deletedAt: null,
        archived: false,
      },
      select: { id: true, icon: true },
    })
    const iconMap = new Map(pages.map((p) => [p.id, p.icon]))
    const aliveIds = new Set(pages.map((p) => p.id))
    return data.results
      .filter((r) => aliveIds.has(r.pageId))
      .map((r) => ({
        pageId: r.pageId,
        title: r.title,
        icon: iconMap.get(r.pageId) ?? null,
        blockNumber: r.blockNumber,
        excerpt: r.content,
        source: 'qdrant' as const,
      }))
  } catch {
    return [] // soft-fail: timeout, network error, agents 5xx
  }
}
```

Soft-fail is intentional: vector search is best-effort. We additionally re-check
`Page.deletedAt`/`archived` on the web side because the Qdrant index may lag behind the
indexer cron.

### 2.5 Merge in `search.search`

```ts
search: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid(), query: z.string().max(200) }))
  .query(async ({ input, ctx }) => {
    await assertWorkspaceMember(ctx.prisma, ctx.user.id, input.workspaceId)

    const [pgRes, qdRes] = await Promise.allSettled([
      searchPg(ctx.prisma, input.workspaceId, input.query),
      searchQdrant(ctx.prisma, input.workspaceId, input.query),
    ])

    if (pgRes.status === 'rejected') throw pgRes.reason // PG failure is real
    const pg = pgRes.value
    if (pg.length > 0) return pg
    return qdRes.status === 'fulfilled' ? qdRes.value : []
  })
```

PG-branch failure (DB down, malformed migration) propagates as a real tRPC error so the
client can show an error state. Qdrant failures stay silent.

### 2.6 History procedures

`history.add` runs:

```ts
await ctx.prisma.searchHistory.upsert({
  where: { userId_workspaceId_pageId: { userId, workspaceId, pageId } },
  create: { userId, workspaceId, pageId, lastVisitedAt: new Date() },
  update: { lastVisitedAt: new Date() },
})
// Prune to 20 most recent
await ctx.prisma.$executeRaw`
  DELETE FROM "SearchHistory"
  WHERE "userId" = ${userId}::uuid
    AND "workspaceId" = ${workspaceId}::uuid
    AND id NOT IN (
      SELECT id FROM "SearchHistory"
      WHERE "userId" = ${userId}::uuid AND "workspaceId" = ${workspaceId}::uuid
      ORDER BY "lastVisitedAt" DESC LIMIT 20
    )
`
```

The whole upsert is wrapped in `try/catch (P2003 FK violation) → silently skip` to handle
the rare case where a page is deleted between the search call and the click.

`history.list` joins `Page` and `FavoritePage` to build `HistoryItem[]` and filters out
rows whose page is now `deletedAt != null` or `archived = true`.

`history.remove` is a plain `deleteMany` keyed on the unique tuple.

## Section 3: Frontend

### 3.1 Search dialog context

New file `apps/web/src/components/search/search-dialog-provider.tsx`:

```tsx
'use client'

type Ctx = { open: () => void; close: () => void; isOpen: boolean }
const SearchDialogContext = createContext<Ctx | null>(null)

export function SearchDialogProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: ReactNode
}) {
  const [isOpen, setOpen] = useState(false)
  const value = useMemo<Ctx>(
    () => ({ open: () => setOpen(true), close: () => setOpen(false), isOpen }),
    [isOpen],
  )
  return (
    <SearchDialogContext.Provider value={value}>
      {children}
      {isOpen && <SearchDialog workspaceId={workspaceId} onClose={() => setOpen(false)} />}
    </SearchDialogContext.Provider>
  )
}

export function useSearchDialog(): Ctx {
  const ctx = useContext(SearchDialogContext)
  if (!ctx) throw new Error('useSearchDialog must be used within SearchDialogProvider')
  return ctx
}
```

Mounted inside `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`'s
client wrapper, so its scope is exactly the workspace subtree (the hotkey is only active
there).

### 3.2 Sidebar entry

Edit `apps/web/src/components/workspace/workspace-sidebar.tsx`. Insert
`<SidebarSearchTrigger />` immediately before `<SearchSidebarSection />` (current line
156). Component:

```tsx
'use client'

import SearchIcon from '@repo/ui/components/SearchIcon'
import { useSearchDialog } from '../search/search-dialog-provider'
// ...

export function SidebarSearchTrigger() {
  const { open } = useSearchDialog()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const hint = isMac ? '⌘K' : 'Alt+K'
  return (
    <ListItemButton onClick={open} dense>
      <ListItemIcon>
        <SearchIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary="Поиск" />
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    </ListItemButton>
  )
}
```

This deliberately does **not** extend the existing `NavItem` (which is `href`-bound) — a
button-shaped sibling avoids breaking the active-route highlight semantics.

### 3.3 SearchDialog

File: `apps/web/src/components/search/search-dialog.tsx`. Uses `Dialog` from
`@repo/ui/components` with `fullWidth maxWidth="sm" keepMounted={false}` and no
`<DialogTitle>`.

Layout:

```
┌──────────────────────────────────────────────────────────┐
│ [SearchIcon] [TextField autofocus, no border]    [Esc]  │  sticky header, py 12px
├──────────────────────────────────────────────────────────┤
│ EmptyState | LoadingState | ResultsState | NoResultsState│
└──────────────────────────────────────────────────────────┘
```

State machine (all derived from local `query` string):

| State     | Condition                                              | Render                                                                                                |
| --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Empty     | `query.trim() === ''`                                  | "Ранее искали" + history list                                                                         |
| Loading   | `query.trim().length >= 2 && search.search.isFetching` | `<LinearProgress />` (top-of-content); previous results stay visible underneath until new ones arrive |
| Results   | search returned non-empty                              | result list                                                                                           |
| NoResults | search returned empty                                  | text "Ничего не найдено по запросу «...»"                                                             |

Debounce: 250 ms via `useDebouncedValue(query, 250)`. The tRPC query key is
`['search.search', { workspaceId, query: debouncedQuery }]` so React Query naturally
discards stale responses.

`enabled: debouncedQuery.trim().length >= 2`.

#### EmptyState row

```
[HistoryIcon] {title}                         [⭐]  [✕]
```

- `[⭐]` calls `page.addFavorite` / `page.removeFavorite` (existing procedures). Filled
  star if `isFavorite`.
- `[✕]` calls `search.history.remove`.
- Click on the row body → same navigation as a result click (records history and
  navigates).

#### Result row

```
[PageIcon] {title}
└ Блок {blockNumber + 1}: …{excerpt with <mark>match</mark>}…
```

The second line is hidden when `blockNumber === null` (non-TEXT page or title-only
match). Excerpt highlighting is implemented by splitting on a case-insensitive regex
of the query and wrapping matches in `<mark>` elements (no `dangerouslySetInnerHTML`).

#### Click behavior

```ts
async function onResultClick(item: SearchResultItem) {
  void trpc.search.history.add.mutate({ workspaceId, pageId: item.pageId })
  onClose()
  const hash = item.blockNumber !== null ? `#${item.blockNumber}` : ''
  router.push(`/workspaces/${workspaceId}/pages/${item.pageId}${hash}`)
}
```

`history.add` is fire-and-forget — navigation must not wait for it.

#### Close behavior

- `Esc` key (handled by MUI Dialog).
- Click on backdrop (MUI Dialog default).
- Explicit "Esc" button in the header is a visual hint that also dispatches `onClose`.

### 3.4 Hotkey

Hook in the workspace layout client:

```tsx
'use client'

export function useSearchHotkey() {
  const { open } = useSearchDialog()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
      const trigger =
        (isMac && e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'k') ||
        (!isMac && e.altKey && !e.metaKey && e.key.toLowerCase() === 'k')
      if (!trigger) return
      e.preventDefault()
      open()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])
}
```

Called from a small client component mounted inside `SearchDialogProvider`'s subtree.
Outside `/workspaces/[id]/...` the listener is unmounted, so the hotkey is dead at the
marketing pages and auth flow.

If a TipTap `Cmd+K` link binding ever steals focus from the global handler, mitigation
is to attach the listener with `capture: true`. Defer until observed.

### 3.5 Transpile / module wiring

The new `apps/web/src/components/search/*` is plain Next.js source (not a workspace
package), so no `transpilePackages` change is required. Icons (`SearchIcon`,
`HistoryIcon`, `StarIcon`, `StarOutlineIcon`, `CloseIcon`) come from `@repo/ui/components`
which already re-exports MUI icons.

## Section 4: Edge cases

- **Input sanitization**: `websearch_to_tsquery` is the only path used; safe against user
  input including unbalanced quotes.
- **Empty / single-character queries**: client doesn't fire tRPC; server also short-circuits
  if the trimmed query is shorter than 2 characters.
- **Long queries**: client trims to 200 chars; server enforces the same cap via Zod and
  Pydantic.
- **Stale responses**: React Query keys include the debounced query, so out-of-order
  responses never overwrite the current view.
- **Deleted/archived pages**: filtered out in both PG branch (SQL) and Qdrant branch
  (post-fetch DB check). `history.add` survives the rare race via `try/catch` on FK
  violation.
- **Workspace switch with dialog open**: layout remounts → provider remounts → dialog
  closes automatically.
- **Hotkey inside editable areas**: TipTap's link dialog uses `Cmd+K`; if a collision is
  observed we'll switch the global listener to `capture: true` so the global handler
  fires first. Deferred unless reproduced.
- **Highlighting the excerpt**: split-and-wrap, no `dangerouslySetInnerHTML`.
- **Accessibility**: MUI `Dialog` provides `role="dialog"`, `aria-modal`, focus trap.
  Result list uses `role="listbox"` with each row `role="option"`. Keyboard arrow
  navigation between results is out of scope.
- **Locale**: `'russian'` text-search config covers Cyrillic stemming and matches Latin
  tokens unstemmed. Mixed corpora are acceptable for v1; tunable later.
- **FTS performance**: GIN-indexed `searchVector` + `LIMIT 10` keeps the query in tens of
  milliseconds even at 100 k pages per workspace. JSON walk runs only on the 10 returned
  rows.

## Section 5: Testing

| Layer              | File                                                                        | Coverage                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit               | `packages/trpc/src/services/__tests__/page-search.test.ts` (vitest)         | `findFirstMatchingBlock`, `extractExcerpt` against multiple Tiptap-JSON shapes; multi-byte / Cyrillic input; no-match path                                                                                              |
| Integration tRPC   | `packages/trpc/test/search.test.ts` (vitest, real Postgres via dev compose) | PG-branch with seeded pages (title-only, content match, archived/deleted excluded); merge precedence; Qdrant branch with mocked `fetch`; soft-fail; history upsert/prune/list/remove                                    |
| Integration agents | `apps/agents/tests/test_search.py` (pytest)                                 | `POST /v1/search` happy path with mocked Qdrant; workspace filter; dedupe; missing collection → 200 with empty list                                                                                                     |
| E2E                | `apps/e2e/search.spec.ts` (Playwright)                                      | `signUpAndAuthAs` → seed two pages → open dialog via `Cmd+K` → type → click result → assert URL has `#blockNumber` and the target block has `block-flash` class → reopen dialog → empty state lists the page in history |

## Section 6: Verification before completion

Per user request, after implementation run:

```
pnpm run lint
pnpm run format
pnpm run check-types
```

Additionally — and matching repo convention — `pnpm gates` before commit (lint + types

- build + test). Husky enforces `pnpm gates` on commit.

## Section 7: Sequencing summary

The implementation plan (next document) will fan out roughly as follows:

1. Schema + migration: `Page.searchVector` and `SearchHistory` model.
2. `apps/agents` `POST /v1/search` endpoint + tests.
3. `packages/trpc` `search` router + service helpers + tests.
4. `apps/web` `SearchDialogProvider`, `SearchDialog`, sidebar trigger, hotkey hook.
5. E2E spec and final lint/format/types/gate run.
