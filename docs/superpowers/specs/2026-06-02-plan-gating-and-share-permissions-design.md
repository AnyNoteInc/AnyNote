# Plan-gating UI + share permissions fix — Design (Spec 1 of 2)

**Date:** 2026-06-02
**Status:** Approved, ready for implementation plan
**Scope:** Spec 1 covers display gating (A, B) + share rendering verification (C) +
the "commenter can edit" permissions fix for all Yjs boards (D) + kanban
permissions for the **workspace-member path**: client-side editable-gating **and**
server-side role enforcement in the kanban domain service (a real, reproducible bug
today — see E3). **Spec 2 (separate, later cycle)** covers full kanban share access
for anonymous / non-member guests (share-token transport into kanban tRPC, anonymous
task comments, schema migration) and is intentionally out of scope here.

## Problem

Two unrelated groups of edits requested by the user:

1. **Display gating by plan.** On the Personal (free) plan, some UI must be hidden:
   the chat section in the workspace sidebar, and three settings sections
   (Участники / AI агент / MCP серверы). Plus cosmetic settings-nav changes
   (rename "Файлы" → "Библиотека", add icons to all 7 items).
2. **Share permissions are broken.** A "commenter" can edit shared non-text pages
   because the `editable` flag is only honoured by the TEXT editor; every other
   board ignores it. Sharing should work and be correctly permission-gated for all
   page types. Kanban additionally needs commenter-can-comment behavior.

## Decisions (from brainstorming)

- **Gate by plan capability flags, not by `slug === 'personal'`.** The `Plan` model
  already exposes `chatsEnabled`, `membersSettingsEnabled`, `aiSettingsEnabled`,
  `customMcpEnabled`. Gating on these is forward-compatible (Pro/Max get features
  by their own flags, not a hardcoded slug).
- **Icons on all 7 settings items** + fix the `slug === 'free'` → `'personal'` bug.
- **Genogram read-only = "view + pan/zoom"** (block node editing, keep pan/zoom).
  `GenogramFlow` already implements exactly this via `mode='readonly'`.
- **Kanban enforcement: server + client.** Mutations require an editor-or-above
  workspace role (OWNER/ADMIN/EDITOR); comments require comment-or-above
  (everyone except VIEWER/GUEST). Enforced by workspace `RoleType` in Spec 1; the
  share-token transport that feeds the same guards for non-members is Spec 2.
- **Two specs.** This is Spec 1. Spec 2 = full anonymous kanban share.

## A. Hide chat in the workspace sidebar (Personal plan)

**Where:** `apps/web/src/components/workspace/workspace-sidebar.tsx`
(`WorkspaceSectionSwitcher`), reading the already-mounted `usePlanFeatures()`
context (provided by `(protected)/workspaces/[workspaceId]/layout.tsx` via
`PlanFeaturesProvider`).

**Change:**
- When `!features.chatsEnabled`, do not render the "Чаты" button in the section
  switcher.
- Guard against direct navigation: in `workspace-layout-client.tsx`,
  `sidebarSectionFromPathname` / the default section must not resolve to `'chats'`
  when chats are disabled — fall back to `'pages'`. If `activeSection` ends up
  `'chats'` while disabled, coerce to `'pages'`.
- The `chatsEnabled` flag is already available client-side; no new query.

**Note:** The chat *routes* (`/workspaces/{id}/chats/*`) hiding from the nav does
not block a typed URL. A server-side redirect/`notFound()` on the chats route group
is desirable but is a thin follow-up; the implementation plan will decide whether to
include a route guard in this spec or note it. (Primary requirement is the sidebar
hide.)

## B. Settings nav: gate sections, rename Files, add icons, fix bug

**Where:** `apps/web/src/components/workspace/workspace-settings-nav.tsx` (client),
which is mounted inside the sidebar and reads `usePlanFeatures()`.

**Changes:**
1. Replace the static `show: true` array with capability-driven `show`:
   - Общее → always
   - Участники → `features.membersSettingsEnabled`
   - AI агент → `features.aiSettingsEnabled`
   - MCP серверы → `features.customMcpEnabled`
   - Библиотека (renamed from Файлы) → always
   - Использование → always
   - Опасная зона → always
2. Rename label "Файлы" → "Библиотека" here, and the card title in
   `apps/web/src/components/workspace/settings/files-section.tsx` (line ~142).
   Slug/route stays `files` (no route rename — avoids breaking links).
3. Add an icon to every item (MUI icons via `@repo/ui/components`, `fontSize="small"`,
   matching `settings/settings-nav.tsx`). Proposed:
   - Общее → `SettingsIcon`
   - Участники → `PersonAddIcon` (or `GroupIcon`)
   - AI агент → `SmartToyIcon` (verify export in `@repo/ui`; fallback `AutoAwesomeIcon`)
   - MCP серверы → `LeakAddIcon` (or `HubIcon`)
   - Библиотека → `StorageIcon` (or `LibraryBooksIcon` / `InsertDriveFileIcon`)
   - Использование → `BarChartIcon` (or `InsightsIcon`)
   - Опасная зона → `WarningAmberIcon` (or `DeleteIcon`)
   - Final icon choices verified against `packages/ui/src/components/index.ts`
     re-exports; add any missing re-export there.
4. Render the icon beside the label (small flex row).

**Route guards (server-side, defense in depth):**
- `settings/members/page.tsx`: already has `notFound()` on `!membersSettingsEnabled`.
  **Fix the bug** on line ~23: `locked={plan.slug === 'free'}` → `plan.slug === 'personal'`.
- `settings/ai/page.tsx`: already guards `!aiSettingsEnabled` ✅.
- `settings/mcp/page.tsx`: currently guards `!aiSettingsEnabled`. Since the nav now
  gates MCP on `customMcpEnabled`, **align the route guard** to `!customMcpEnabled`
  (or both) so the nav and the route agree.

## C. Sharing works for all page types

**Current:** `/s/{shareId}` reuses `PageRenderer`, dispatching on `page.type`.
Supported renderers: TEXT, EXCALIDRAW, GENOGRAM, MERMAID, PLANTUML, LIKEC4, DRAWIO,
KANBAN. DATABASE and FORM have **no renderer anywhere** (not even in-app) → out of
scope (not a sharing problem).

**Work:**
- Confirm each of the 8 supported types opens via a share link and renders content
  (not a "type not supported" message or an infinite spinner). Yjs boards already
  use the share-scoped token from `/api/yjs/share-token`.
- KANBAN for **workspace members** works once D/E wiring lands; KANBAN for anonymous
  guests is Spec 2 (show a clear fallback message instead of an infinite spinner if
  a guest opens a kanban share in Spec 1).
- **Verification:** a Playwright/E2E pass that opens a share link for each type and
  asserts the renderer mounts. Reuse `apps/e2e` patterns and `encryptFixture`/Prisma
  setup from existing share specs.

## D. Fix "commenter can edit" — propagate `editable` to every board

**Root cause:** `PageRenderer` receives `editable` (default `true`) but only the
TEXT branch passes it down (line ~462). Every board branch ignores it, so
COMMENTER/READER see an editable UI. The Yjs server already enforces read-only at
the protocol level for READER+COMMENTER (backend safety net) — this is a client-UX
correctness fix.

**Per-type changes in `apps/web/src/components/page/page-renderer.tsx`:**

| Type | Prop available? | Change |
|------|-----------------|--------|
| EXCALIDRAW | `BoardProps.editable` → `viewModeEnabled` ✅ | pass `editable={editable}` |
| MERMAID/PLANTUML/LIKEC4 | `DiagramBoardProps.editable` ✅ (default `true`) | pass `editable={editable}` |
| GENOGRAM | `GenogramBoardProps.mode` exists; `GenogramFlow` already maps `mode='readonly'` → `nodesDraggable/Connectable/elementsSelectable=false`, keeps `panOnDrag`+`zoomOnScroll` | pass `mode={editable ? 'editor' : 'readonly'}` |
| DRAWIO | accepts `editable` but draw.io iframe has no read-only toggle we wire | pass `editable={editable}`; document the limitation — Yjs server still rejects writes |
| KANBAN | no role/editable today | see E |
| TEXT | works ✅ | no change |

**Two-layer defense remains:** Yjs server `readOnly` (backend) + client `editable`
(UX). After this, COMMENTER/READER no longer see an editable UI on any Yjs board.

## E. Kanban (Spec-1 portion): member-path role enforcement + editable-gating

> Full anonymous / non-member kanban share = **Spec 2**. Spec 1 handles kanban
> opened by an authenticated **workspace member**, gating edit vs comment by the
> member's workspace `RoleType` (server) and hiding edit affordances (client) so a
> COMMENTER member can comment but not edit.

**E1. Pass role/editable into the kanban client.**
- `PageRenderer` passes `editable` (and `shareId` if present) to `KanbanBoardPage`.
- `KanbanBoardPage` accepts `editable?: boolean` (default `true`) and threads it to
  toolbar/board/table/gantt views and the task-detail UI.

**E2. Client editable-gating (UX).**
- When `editable === false`: hide/disable create-task, create-column, drag-and-drop
  move, delete, archive, label edit, assignee edit. Keep the board/table/gantt
  read-only and navigable.
- COMMENTER (i.e. `editable === false` but can comment) still sees the task comment
  composer in the task detail. The "can comment" signal is derived the same way as
  page comments (`role !== 'READER'`).

**E3. Server enforcement (defense in depth, member path) — IN SPEC 1.**
- **Real, reproducible bug today:** `RoleType` includes `COMMENTER` and `VIEWER`.
  Kanban mutations in `packages/domain/src/kanban/services/kanban.service.ts` gate on
  `assertAccess` → `repo.findAccessiblePage(userId, pageId)`, which checks **workspace
  membership only, not role**. Only delete-style ops use `assertOwnership` (requires
  OWNER). Therefore a workspace member with role `COMMENTER` or `VIEWER` can today
  create/update/move tasks and edit the board. This is exactly the user's reported
  "commenter can edit" bug, and it is a member-path bug — **it must be fixed in
  Spec 1**, not deferred.
- **Change:** introduce a role-aware edit guard in the kanban domain service, e.g.
  `assertCanEdit(userId, pageId)` that resolves the member's `RoleType` via
  `repo.findMembershipRole` and requires an editor-or-above role
  (`OWNER`/`ADMIN`/`EDITOR`). Apply it to every mutating kanban operation
  (create/update/move/setAssignees/setLabels/archive/unarchive task, and column
  mutations). Keep `assertOwnership` semantics for delete where stricter.
- **Comment path:** `createTaskComment` requires comment-or-above
  (`OWNER`/`ADMIN`/`EDITOR`/`COMMENTER`) — i.e. everyone except `VIEWER`/`GUEST`.
  This lets a COMMENTER member comment but not edit, matching the requirement
  "в канбан комментатор может оставлять комментарии к задачам".
- **Scope boundary with Spec 2:** Spec 1 enforces by **workspace `RoleType`** (the
  member path) because that path exists and is broken today. Spec 2 adds the
  **share-token transport** so non-members / anonymous guests reach these same guards
  with a resolved share role. The guard signature should be designed so Spec 2 can
  feed it a share-derived effective role without rewriting call sites.
- The Yjs-board fixes (D) are already server-enforced by the Yjs `readOnly` flag;
  the kanban guard (E3) brings kanban mutations up to the same server-enforced bar
  for the member path.

**E4. Comments.**
- `kanban.comment.create` currently allows any authenticated workspace member to
  comment with no role check. Spec 1 adds the comment-or-above role guard (E3) so a
  `VIEWER`/`GUEST` member cannot comment, while a `COMMENTER` member can. The UI
  exposes the comment composer to COMMENTER and hides editing affordances. No schema
  change needed for the member path (`authorId` = the member's user id). Anonymous
  comment authorship (`authorAnonId`) is Spec 2.

## Components & boundaries

- **Plan features** flow unchanged: server `getWorkspaceFeatures(workspaceId)` →
  `PlanFeaturesProvider` → `usePlanFeatures()`. A/B read this; no new query.
- **`editable`** flows: share route resolves `role` →
  `editable = role ∈ {EDITOR, OWNER}` → `SharePageClient` → `PageRenderer` → each
  board. D makes every board honour it.
- **Kanban editable** is a new prop threaded from `PageRenderer` through
  `KanbanBoardPage` to its views; isolated to the kanban component tree.

## Testing

- **A/B:** unit/component tests that the chat button and gated settings items are
  absent under a Personal `PlanFeatures` and present under Pro/Max. A test for the
  `'free' → 'personal'` fix (members page `locked`). Verify renamed label and icons
  render.
- **C:** E2E share-open smoke for each of the 8 supported types (kanban-as-member).
- **D:** component tests that each board receives `editable=false` and renders in a
  non-editable mode (e.g. Excalidraw `viewModeEnabled`, Genogram `readonly`,
  diagram boards read-only source). Plus an E2E: open a COMMENTER share link to an
  Excalidraw/Mermaid/Genogram page and assert no editing affordance.
- **E (Spec-1 portion):**
  - Domain unit tests (`packages/domain`) that kanban mutations throw `forbidden`
    for a `COMMENTER`/`VIEWER` member and succeed for `EDITOR`/`ADMIN`/`OWNER`; that
    `createTaskComment` succeeds for `COMMENTER` and throws for `VIEWER`/`GUEST`.
  - Component test that `KanbanBoardPage` with `editable=false` hides
    create/drag/delete controls and still shows the comment composer.
- All work must pass `pnpm gates` (check-types + lint + build + test). Yjs-dependent
  E2E has caveats (no yjs server under Playwright per project memory) — assert
  pre-reload / decoration behavior, not post-reload persistence.

## Out of scope (Spec 2)

- Anonymous (non-member) kanban share: share-token transport into kanban tRPC
  context, share-role-aware authorization for all kanban mutation/query routers,
  anonymous task-comment authorship (`authorAnonId`/`authorAnonName`) and the
  required `TaskComment` schema migration, share-scoped kanban realtime.
- DATABASE / FORM page renderers (do not exist in-app).
