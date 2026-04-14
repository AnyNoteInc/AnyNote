# Workspace Polish Pass — Design Spec

**Date:** 2026-04-11
**Status:** Approved (pending written-spec review)
**Depends on:** `docs/specs/2026-04-11-workspaces-and-settings.md`

## Goal

Second pass over the workspace + settings surface: close the 14 follow-up items the user listed after the first review. The pass converts the hard-coded Notion-style start page into data-driven blocks, introduces chat-style search, adds workspace settings gated by plan, unifies theming, and cleans up UI deltas.

## Scope

All 14 user items are handled in one spec because they share surface area (sidebar, workspace shell, theme tokens). The structural parts (Block model, SearchChat, workspace settings) are the only pieces that touch schema and routers; the rest is route additions and CSS/JSX cleanup.

### In scope

1. `/profile` — new protected page (avatar, name, workspace cards with "Перейти")
2. `/settings` — redirect to `/settings/general`
3. Global thinner typography weights
4. `(protected)` group responds to user's theme preference
5. `/workspaces` — redirect to default workspace or `/workspaces/new`
6. Workspace group changes:
   1. Remove `WorkspaceAiPanel` (no right column)
   2. `/workspaces/[id]/search[/chatId]` — chat-style search (echo MVP)
   3. Remove "Главная" link from sidebar
   4. Workspace area honours light/dark theme
   5. Collapsible left sidebar (icon rail, 56px)
   6. Start page created as `Page` + `Block` rows on workspace creation
   7. `/workspaces/[id]/settings` (rename, members, delete — plan-gated)
   8. Remove Share / ⋯ / New AI chat from toolbar
   9. tRPC `loggerLink` removed so FORBIDDEN on plan limit doesn't open Next dev overlay
7. Remove hand-rolled CSS/hex colors in favor of MUI theme tokens

### Out of scope (explicit YAGNI)

- Block editor (inline edit, slash commands, drag-to-reorder)
- Real RAG via OLLAMA + Weaviate (echo stub for MVP)
- Email invites for unregistered users
- Media blocks (IMAGE/VIDEO/FILE) rendering — enum values reserved
- Workspace switcher UI
- Page CRUD beyond the seeded start page

## Architecture Decisions

### D1 — Block model (Notion-like, separate table)

Considered: (A) `Page.content: Json`, (B) separate `Block` table, (C) Markdown string.
**Chosen: B.** User wants a proper Notion-style model so future editor work has a stable foundation.

### D2 — Ordering model: linked list via `prevBlockId`

Considered: (A) fractional decimal, (B) integer with resequence, (C) LexoRank, (D) linked list.
**Chosen: D.** Matches Notion. Read the full page in one `SELECT`, walk the chain in memory.

### D3 — Block types: full Notion set

**Chosen: C.** Enum contains all Notion core + media types. Only the `B subset` (PARAGRAPH, HEADING*1/2/3, TO_DO, BULLETED*/NUMBERED_LIST_ITEM, TOGGLE, QUOTE, CALLOUT, DIVIDER, CODE) is rendered/validated in MVP. Remaining values (IMAGE, VIDEO, FILE, PDF, BOOKMARK, EQUATION, TABLE, COLUMN, SYNCED_BLOCK, LINK_TO_PAGE) are reserved — documented here so no one wires them up prematurely.

### D4 — Search = chat per workspace

Considered: (A) title-only ILIKE, (B) title + block text ILIKE, (C) tsvector FTS, (D) Weaviate.
**Chosen: ChatGPT-style chat UI, echo responses, persisted conversations.** Each workspace has many `SearchChat` rows, each holding `SearchMessage` rows (USER/ASSISTANT). MVP assistant reply is a canned echo; RAG comes later.

### D5 — Sidebar collapse: icon rail (56px)

Considered: (A) 56px icon rail, (B) full 0px hide.
**Chosen: A.** Matches Notion/Linear. Quick access to Search/Settings without reopening.

### D6 — Plan gating for workspace settings

All three destructive actions (rename, invite, delete) are gated to `plan.slug !== "free"`. Free users see the settings page as read-only with disabled buttons + upgrade tooltip.

### D7 — Thin fonts: global MUI typography weights

One change in `packages/ui/src/theme/theme.ts`:

- `fontWeightLight: 200`
- `fontWeightRegular: 300` (was 400)
- `fontWeightMedium: 400` (was 500)
- `fontWeightBold: 500` (was 700)
- `h1..h3: { fontWeight: 300 }`, `h4..h6: { fontWeight: 400 }`, `button/subtitle*: { fontWeight: 400 }`

With the new scale, `300 = fontWeightRegular`, `400 = fontWeightMedium`. Headings use `fontWeight: 300` (regular) for a lighter look; the existing MUI defaults (500+) are overridden everywhere.

All hand-rolled `fontWeight={600|700}` in workspace/settings components are removed so global tokens take over.

### D8 — Theme-reactive `(protected)` group

`WorkspaceShell` drops its internal `ThemeProvider(createAppTheme("dark"))`. The root `app/layout.tsx` already supplies a theme derived from cookie/`UserPreference.theme` — `(protected)` inherits it.

All `#hex` colors in `workspace-*.tsx`, `cookie-banner.tsx`, settings components are replaced with theme tokens: `bgcolor: "background.default"`, `color: "text.primary|secondary"`, `borderColor: "divider"`. The one brand gradient (`linear-gradient(135deg, #0f766e, #155e75)`) moves into `theme.palette.workspaceGradient` as a custom key and is consumed via theme.

`resolveTheme()` is fixed to respect `system` mode: server still renders `light` as fallback (can't read OS preference in RSC), but `UiProvider` on the client listens to `prefers-color-scheme` and flips after hydration if the stored pref is `system`.

### D9 — tRPC logger removal

`packages/trpc/.../client.tsx` drops `loggerLink` entirely. Mutation errors still propagate to `useMutation.onError` and show as `Alert` in forms. Users no longer see the Next dev overlay on expected `FORBIDDEN` responses.

## Data Model

### `Block`

```prisma
enum BlockType {
  // MVP-rendered
  PARAGRAPH
  HEADING_1
  HEADING_2
  HEADING_3
  TO_DO
  BULLETED_LIST_ITEM
  NUMBERED_LIST_ITEM
  TOGGLE
  QUOTE
  CALLOUT
  DIVIDER
  CODE
  // Reserved
  IMAGE
  VIDEO
  FILE
  PDF
  BOOKMARK
  EQUATION
  TABLE
  COLUMN
  SYNCED_BLOCK
  LINK_TO_PAGE
}

model Block {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  type          BlockType
  pageId        String    @db.Uuid @map("page_id")
  parentBlockId String?   @db.Uuid @map("parent_block_id")
  prevBlockId   String?   @db.Uuid @map("prev_block_id")
  content       Json      @default("{}")
  createdById   String    @db.Uuid @map("created_by_id")
  updatedById   String?   @db.Uuid @map("updated_by_id")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  archivedAt    DateTime? @map("archived_at")

  page       Page    @relation(fields: [pageId], references: [id], onDelete: Cascade)
  parent     Block?  @relation("BlockTree", fields: [parentBlockId], references: [id], onDelete: Cascade)
  children   Block[] @relation("BlockTree")
  prev       Block?  @relation("BlockPrev", fields: [prevBlockId], references: [id], onDelete: SetNull)
  next       Block?  @relation("BlockPrev")
  createdBy  User    @relation("BlockCreator", fields: [createdById], references: [id], onDelete: Restrict)
  updatedBy  User?   @relation("BlockUpdater", fields: [updatedById], references: [id], onDelete: SetNull)

  @@unique([parentBlockId, prevBlockId], map: "blocks_parent_prev_unique")
  @@index([pageId])
  @@index([pageId, parentBlockId])
  @@map("blocks")
}
```

**Linked-list invariants** (enforced at the database level):

1. `@@unique([parentBlockId, prevBlockId])` — in a sibling group, at most one block can claim a given predecessor. Catches concurrent inserts that try to splice into the same slot.
2. Two partial unique indexes ensure exactly one _head_ (null `prev`) per sibling group:

```sql
-- one root-level head per page
CREATE UNIQUE INDEX blocks_head_root
  ON blocks (page_id)
  WHERE parent_block_id IS NULL AND prev_block_id IS NULL;

-- one head per nested sibling group
CREATE UNIQUE INDEX blocks_head_nested
  ON blocks (parent_block_id)
  WHERE parent_block_id IS NOT NULL AND prev_block_id IS NULL;
```

Both are added as raw SQL inside the Prisma migration after the generated DDL.

### `Page` — back-relation only

`Page` already has `title`, `icon`, `parentType`, `parentId`, `createdById`. The only additive change is a back-relation to `Block`:

```prisma
model Page {
  // ...existing fields
  blocks Block[]
}
```

No column additions, no data migration.

### `SearchChat` + `SearchMessage`

```prisma
model SearchChat {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @db.Uuid @map("workspace_id")
  createdById String   @db.Uuid @map("created_by_id")
  title       String   @default("Новый поиск")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  workspace Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy User            @relation(fields: [createdById], references: [id], onDelete: Restrict)
  messages  SearchMessage[]

  @@index([workspaceId, updatedAt(sort: Desc)])
  @@map("search_chats")
}

enum SearchMessageRole {
  USER
  ASSISTANT
}

model SearchMessage {
  id        String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  chatId    String            @db.Uuid @map("chat_id")
  role      SearchMessageRole
  content   String            @db.Text
  sources   Json              @default("[]")
  createdAt DateTime          @default(now()) @map("created_at")

  chat SearchChat @relation(fields: [chatId], references: [id], onDelete: Cascade)

  @@index([chatId, createdAt])
  @@map("search_messages")
}
```

`sources` is reserved for future RAG: array of `{ pageId, blockId?, snippet }`.

### Migration

One migration: `20260411_xxxx_add_blocks_search_chats`. Creates:

- `BlockType` type
- `SearchMessageRole` type
- `blocks` table with all FKs, indexes, `@@unique([parentBlockId, prevBlockId])`
- Partial unique indexes `blocks_head_root` and `blocks_head_nested`
- `search_chats` + `search_messages` tables

Post-migration: `pnpm --filter @repo/db prisma:generate`.

### `packages/db/src/index.ts` — explicit re-exports

Adds `BlockType`, `SearchMessageRole`, `Block`, `Page`, `SearchChat`, `SearchMessage` to the named export list that replaced `export * from "@prisma/client"` during the review pass.

## tRPC

### `blockRouter` (new)

```
listByPage({ pageId }) -> Array<BlockWithDepth>
  - findMany({ where: { pageId, archivedAt: null } })
  - in-memory topo-sort via prev chain; builds tree per parentBlockId
  - returns flat array with `depth` and `childrenIds`
create({ pageId, parentBlockId?, afterBlockId?, type, content })
  - validates content via discriminated union by type
  - transaction: insert + rewire prev pointer of ex-next
update({ id, content })
move({ id, newParentBlockId?, newAfterBlockId? })
archive({ id })  // archivedAt=now + rewire neighbors
```

Content Zod schemas live in `packages/trpc/src/schemas/block-content.ts` — one schema per rendered type, discriminated by `type`. Reserved types reject at the API boundary.

### `pageRouter` (new, minimal)

```
getById({ id })
listByWorkspace({ workspaceId })
```

Only read operations needed for the seeded start page. Full CRUD deferred to the editor spec.

### `searchRouter` (new)

```
listChats({ workspaceId })
getChat({ chatId })                  -> chat + messages
createChat({ workspaceId })          -> chatId
sendMessage({ chatId, content })
  - transaction:
      1. insert USER message
      2. insert ASSISTANT echo message: `🔎 MVP echo: "${content}". Настоящий RAG подключим с OLLAMA + Weaviate.`
      3. if first user message: set chat.title to first 48 chars of content
      4. touch chat.updatedAt
deleteChat({ chatId })
```

All procedures check the caller is a `WorkspaceMember`.

### `workspaceRouter` — additions

```
rename({ id, name, icon? })        // plan-gated, OWNER/ADMIN
listMembers({ workspaceId })
inviteMember({ workspaceId, email, role })
  // plan-gated, OWNER only
  // MVP: look up user by email; if not found -> TRPCError NOT_FOUND
  //                                              with message "Email invites coming soon"
removeMember({ workspaceId, userId })  // OWNER only; cannot remove last OWNER
delete({ id })                          // plan-gated, OWNER only
create({ name, icon })                  // MODIFIED: also seeds Page + Blocks
```

`seedStartPage(tx, workspaceId, userId)` helper creates the Welcome page and 10 blocks (9 TO_DO + 1 TOGGLE) chained via `prevBlockId`. Called inside the existing `$transaction`.

### `trpc/client.tsx` — removed `loggerLink`

Link chain becomes `[httpBatchLink(...)]` only. Errors still flow to `useMutation.onError`.

## Routes

### New

| Path                                         | Type   | Purpose                                            |
| -------------------------------------------- | ------ | -------------------------------------------------- |
| `/profile`                                   | Server | User profile with avatar/name/workspace cards      |
| `/settings/page.tsx`                         | Server | `redirect("/settings/general")`                    |
| `/workspaces/page.tsx`                       | Server | redirect to default workspace or `/workspaces/new` |
| `/workspaces/[id]/search/page.tsx`           | Server | redirect to latest chat or empty state             |
| `/workspaces/[id]/search/[chatId]/page.tsx`  | Server | chat view                                          |
| `/workspaces/[id]/settings/page.tsx`         | Server | `redirect("/workspaces/[id]/settings/general")`    |
| `/workspaces/[id]/settings/general/page.tsx` | Server | Workspace rename                                   |
| `/workspaces/[id]/settings/members/page.tsx` | Server | Member list + invite                               |
| `/workspaces/[id]/settings/danger/page.tsx`  | Server | Delete workspace                                   |
| `/workspaces/[id]/settings/layout.tsx`       | Server | 2-pane: nav + content                              |

### Modified

| Path                        | Change                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `/workspaces/[id]/page.tsx` | Now fetches first Page + blocks and renders `<PageView>` (deletes `WorkspaceOnboarding`) |

### Removed

- `apps/web/src/components/workspace/workspace-onboarding.tsx` — replaced by data-driven `PageView`
- `apps/web/src/components/workspace/workspace-ai-panel.tsx` — AI panel gone entirely

## Components

### `PageView` (new, server)

`apps/web/src/components/page/page-view.tsx`. Props: `{ page: Page, blocks: Block[] }`. Renders icon + title in a centered 720px column, then maps blocks through `BlockRenderer`. Reserved block types render as `null`.

### `BlockRenderer` (new, server)

Switch by `type`. Each branch renders its block with MUI primitives, respecting `depth` from the topo-sort.

### `WorkspaceSidebar` (modified, now client)

- Props: `{ workspace, pages, searchChats, collapsed, userMenu }`
- Client component for `collapsed` toggle (localStorage-persisted via `use-sidebar-collapsed` hook)
- Removes "Главная"
- "Настройки" now links to `/workspaces/[id]/settings`
- New `SearchSidebarSection` — expandable, lists chats, "+ Новый чат" button
- Footer: `WorkspaceUserMenu`
- Icon-rail mode: 56px width, `Tooltip` on every icon, same sections collapsed to glyphs

### `WorkspaceUserMenu` (new, client)

- Avatar + name (avatar only in collapsed mode)
- `Popover` menu: Мой профиль / Настройки / Сменить тему (submenu) / Выйти
- Sign-out via `signOut()` from `auth-client`

### `WorkspaceSettingsNav` (new, client)

Pattern mirrored from `SettingsNav`. Items: Общее, Участники, Опасная зона. Uses `usePathname` for active state.

### `WorkspaceToolbar` (modified)

Drops Share / ⋯ / New AI chat. Keeps breadcrumb + Private label + edited timestamp.

### `WorkspaceShell` (modified)

Grid changes from `"240px minmax(0,1fr) 340px"` to `"{sidebarWidth} minmax(0,1fr)"` where `sidebarWidth` switches between `240px` and `56px` by `collapsed` state. Inner `ThemeProvider` + `backgroundColor: "#0c0d10"` removed.

### `SearchChatView` (new, server)

Centered column. Messages rendered as stacked cards (USER aligned right, ASSISTANT aligned left), input docked at the bottom via a client-component `SearchChatInput` that calls `searchRouter.sendMessage` and optimistically appends the new messages.

### `SearchChatInput` (new, client)

Textarea + Send button. On submit: disable input, mutate, on success refetch `getChat`. Simple — no streaming.

### `PageView` test double

Playwright test renders the seeded start page and checks for the h1 + 10 blocks.

## Theme

### `packages/ui/src/theme/theme.ts`

- Typography weights flipped to 200/300/400/500 scale
- Augment `palette` with `workspaceGradient: string` (declaration merging on `@mui/material/styles`)
- Ensure dark mode palette has: `background.default` ≈ `#0c0d10`, `background.paper` ≈ `#14161a`, `text.primary` ≈ `#e7e8ea`, `text.secondary` ≈ `#a7aab1`, `divider` ≈ `rgba(255,255,255,0.08)` — these match the current hand-rolled colors so the visual doesn't regress
- Light mode keeps default MUI palette

### `resolveTheme()`

Now returns `"dark" | "light" | "system"`. RSC tree receives `"system"` unchanged; `UiProvider` reads `window.matchMedia('(prefers-color-scheme: dark)')` in a `useLayoutEffect` and calls `setMode` accordingly. Cookie still takes precedence.

## Testing Strategy

- **Existing spec** `workspace-flow.spec.ts` — updated: no more "Главная" link, settings link goes to `/workspaces/[id]/settings`, AI panel removed
- **New** `profile.spec.ts` — navigate to `/profile` after sign-up, assert avatar + name + workspace card
- **New** `workspace-settings.spec.ts` — free user sees disabled buttons + upgrade tooltip
- **New** `search-chat.spec.ts` — create chat, send message, assert echo reply persists
- **New** `block-seed.spec.ts` — asserts the 10 seeded blocks render for a fresh workspace
- All new specs follow the existing pattern (sign up per test via helper).

## Implementation Order (Plan Outline)

30 tasks grouped:

- **A (schema, 5)** — Block/SearchChat models, migration, Prisma generate, `@repo/db` exports
- **B (tRPC, 6)** — block/page/search/workspace routers, seedStartPage helper, loggerLink removal
- **C (theme, 3)** — typography weights, strip hex colors, resolveTheme for `system`
- **D (routes, 7)** — /profile, /settings redirect, /workspaces redirect, /workspaces/[id]/settings suite
- **E (search, 4)** — route structure, SearchChatView, SearchSidebarSection, echo pipeline
- **F (sidebar/UI, 5)** — sidebar collapse, user menu, toolbar cleanup, ai-panel removal, shell grid

Detailed task-by-task plan lives in `docs/plans/2026-04-11-workspace-polish-pass.md` (produced by writing-plans skill).

## Risks & Open Questions

- **Linked-list invariant under concurrent writes.** The partial unique index prevents two "head" blocks but doesn't prevent two siblings from claiming the same `prevBlockId` during concurrent inserts. For MVP (single editor, no realtime collab) the `@@unique([parentBlockId, prevBlockId])` catches it; for real collab we'll need optimistic locking or a dedicated move-API with row locks. Documented; not blocking.
- **Sidebar collapsed state hydration.** SSR reads `sidebar-collapsed` cookie; client syncs from localStorage if present. One-time mismatch acceptable because the transition is only a width change.
- **`system` theme flicker.** First paint may be `light` for users who picked `system` and have a dark OS. Mitigation: `UiProvider` applies the switch in a `useLayoutEffect`, so the flicker is a single frame. Accepted.
