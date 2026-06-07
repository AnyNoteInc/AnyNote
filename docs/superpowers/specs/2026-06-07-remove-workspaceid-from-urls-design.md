# Remove `workspaceId` from user-facing URLs

**Date:** 2026-06-07
**Status:** Approved design, ready for implementation plan

## Goal

Remove `/workspaces/{workspaceId}` from normal user-facing URLs. The current
workspace becomes a **server-side user preference**. Paths become:

- `/pages/{pageId}`
- `/chats/new`
- `/chats/{chatId}`
- `/templates`
- `/templates/{templateId}`
- `/trash`

`workspaceId` is **not** removed from the DB, domain services, Prisma models,
permissions, billing, files, agents, engines, or Yjs. It remains the internal
security boundary and data scope. Only the URL surface and the way the web app
discovers "which workspace am I in" change.

## Non-goals

- No change to workspace membership / role model.
- No change to domain service signatures (`fn(prisma, actorUserId, input)` still
  takes `workspaceId`).
- No change to tRPC procedures' workspace-scoped inputs (they still accept
  `workspaceId`); the UI just sources `workspaceId` from the active workspace
  instead of the URL.
- `/workspaces/new` stays (workspace creation).

## Key decisions (confirmed with user)

1. **Route shell** lives in a `(active)/` route group: `(protected)/(active)/`
   wraps only the neutral resource routes with the workspace shell layout.
   `/settings`, `/profile`, `/notifications`, `/billing` stay outside it.
2. **Attachment upload** drops `workspaceId` from the query for both the page
   editor and Kanban; `/api/files/upload?kind=attachment` resolves the active
   workspace server-side. Avatar upload is unchanged (never needs a workspace).
3. **Notification / email URLs stay on the legacy `/workspaces/{id}/...` scheme.**
   The legacy compatibility routes set the active workspace and redirect to the
   neutral URL (preserving the `#hash`), so existing deep links (reminders,
   comments, invites) keep working without touching `packages/notifications` or
   `packages/mail`.

## Architecture

### 1. Data model (`packages/db`)

Add to `UserPreference` (do **not** reuse `defaultWorkspaceId`):

```prisma
activeWorkspaceId String? @map("active_workspace_id") @db.Uuid
activeWorkspace   Workspace? @relation("ActiveWorkspace", fields: [activeWorkspaceId], references: [id], onDelete: SetNull)

@@index([activeWorkspaceId])
```

Add to `Workspace`:

```prisma
activeForUsers UserPreference[] @relation("ActiveWorkspace")
```

Migration: `prisma migrate dev --name add_active_workspace_id`, then regenerate
the client. `onDelete: SetNull` means deleting a workspace clears active for any
user who had it active — they fall back at next resolve.

### 2. Active-workspace resolution (`packages/trpc`)

New helper `resolveActiveWorkspace(ctx)` (in `packages/trpc/src/helpers/`):

1. Read `UserPreference.activeWorkspaceId`.
2. If set, verify the user is still a member of that workspace
   (`workspaceMember.findUnique`). If yes → return it.
3. Otherwise fall back, in order:
   - `defaultWorkspaceId` if it's still a valid membership;
   - the user's first workspace by `createdAt asc` (the existing `listMine` order).
4. If a fallback workspace is found and differs from the stored
   `activeWorkspaceId`, **repair** it via `userPreference.upsert`
   (set `activeWorkspaceId`).
5. If the user has no workspace at all → return `null`.

Returns the full `Workspace` row (or `null`). Used by RSC pages and the
`(active)/` layout.

New procedures on `workspaceRouter`:

- `getActive` (query) → `resolveActiveWorkspace(ctx)` (Workspace | null).
- `setActive({ workspaceId })` (mutation) → assert membership, write
  `activeWorkspaceId` via upsert, return the workspace. Throws `FORBIDDEN` for
  non-members.

`workspace.create` already sets `defaultWorkspaceId`; also set
`activeWorkspaceId` in the same upsert so a freshly created workspace becomes
active immediately.

### 3. Routes (`apps/web`)

New tree under `(protected)/(active)/`:

```
(protected)/(active)/
  layout.tsx                  resolve active ws; if none -> redirect /workspaces/new;
                              load pages + features; render WorkspaceLayoutClient
  pages/[pageId]/page.tsx
  pages/[pageId]/loading.tsx  (port existing loading.tsx if present)
  chats/new/page.tsx
  chats/[chatId]/page.tsx
  templates/page.tsx
  templates/[templateId]/page.tsx
  trash/page.tsx
```

The `(active)/layout.tsx` replaces today's `workspaces/[workspaceId]/layout.tsx`:
it calls `resolveActiveWorkspace` instead of reading `params.workspaceId`, then
renders `PlanFeaturesProvider` + `WorkspaceLayoutClient` exactly as today. If no
active workspace, `redirect('/workspaces/new')`.

The resource pages mirror today's `workspaces/[workspaceId]/...` pages but:
- read only their own resource id from `params`;
- get `workspaceId` from `resolveActiveWorkspace` (or from the resolved resource,
  see below) instead of `params`.

**Direct-resource active-workspace switching** (`/pages/[pageId]`,
`/chats/[chatId]`): the resource id is a global UUID.
1. Load the resource (`page.getById` / `chat.getChat`) — both already enforce
   membership and return `workspaceId`. If not found / no access → `notFound()`.
2. Resolve the active workspace. If `resource.workspaceId !== active.id`, call
   `setActive({ workspaceId: resource.workspaceId })` and `redirect()` to the
   **same** neutral URL so the shell re-renders under the correct workspace.
   (Redirect, not just render, so the `(active)/layout` re-resolves pages/features
   for the new workspace.)
3. Otherwise render normally.

`/app` page: resolve active workspace; if none → `/workspaces/new`; else compute
the first page in tree order (`firstPageInTreeOrder`) and `redirect` to
`/pages/{id}`, or `/chats/new` if there are no pages. This replaces the old
`/app` → `/workspaces/{id}` redirect and the old `workspaces/[workspaceId]/page.tsx`
root behaviour.

`/workspaces/page.tsx` (no id): redirect to `/app`.

### 4. Legacy compatibility redirects

Keep `(protected)/workspaces/[workspaceId]/...` but turn every page into a thin
server redirect:

- Assert membership of `:workspaceId` (via `workspace.getById`; `null` →
  `notFound()`).
- For resource sub-paths, load the resource and verify
  `resource.workspaceId === :workspaceId`. **If they differ, `notFound()`** — do
  not silently switch (prevents a stale/forged URL from cross-workspace leaking).
- `setActive({ workspaceId })`, then `redirect()` to the neutral URL:
  - `/workspaces/:id` → `/app`
  - `/workspaces/:id/pages/:pageId` → `/pages/:pageId`
  - `/workspaces/:id/chats/new` → `/chats/new`
  - `/workspaces/:id/chats/:chatId` → `/chats/:chatId`
  - `/workspaces/:id/chats` → `/chats/new`
  - `/workspaces/:id/templates` → `/templates`
  - `/workspaces/:id/templates/:templateId` → `/templates/:templateId`
  - `/workspaces/:id/trash` → `/trash`
  - `/workspaces/:id/settings` → `/app` (settings is a dialog now)

The browser preserves the `#hash` across a same-origin redirect, so
`/workspaces/:id/pages/:id#reminder-x` lands on `/pages/:id#reminder-x`.

`(active)/` and `workspaces/[workspaceId]/` are different URL paths, so there is
no route collision.

### 5. UI link generation (`apps/web`)

Replace all `/workspaces/${workspaceId}/...` link/`router.push` construction with
neutral URLs. Files (from the surface map):

- `chat/navigation.ts`: `buildChatHref(chatId)` → `/chats/${chatId}` (drop the
  `workspaceId` param; update all callers).
- `hooks/use-page-actions.tsx`: page create/open → `/pages/${id}`; copy-link uses
  `${origin}/pages/${id}`; export fetch → new API (see §6).
- `components/templates/use-create-page-flow.ts`: → `/pages/${id}`.
- `components/templates/templates-page.tsx`: → `/templates/${id}`.
- `components/templates/template-editor.tsx`: back → `/templates`.
- `components/workspace/favorites-section.tsx`: active check + href → `/pages/${id}`.
- `components/workspace/page-tree-section.tsx`: active check + href → `/pages/${id}`.
- `components/workspace/search-sidebar-section.tsx`: active check + pushes →
  `/chats/${id}`, `/chats/new`.
- `components/search/search-dialog.tsx`: → `/pages/${id}${hash}`.
- `components/search/use-search-hotkey.ts`: → `/chats/new`.
- `components/page/page-renderer.tsx`: `router.push` → `/pages/${id}`.
- `components/workspace/workspace-layout-client.tsx`: breadcrumb hrefs → `/chats/new`,
  `/pages/${id}`.
- `components/page/page-export-dialog.tsx`: URL → new API (see §6).
- `app/(protected)/settings/integrations/mcp/page.tsx`, `profile/page.tsx`,
  `components/settings/integration-card.tsx`: workspace-root links → `/app`;
  "create workspace" stays `/workspaces/new`.

These components mostly already receive `workspaceId` as a prop; many of those
props become unused for URL building (still used for tRPC inputs, so keep them).
`pathname` active-state checks switch to the neutral paths.

**Workspace switcher** (`workspace-sidebar.tsx`): the `MenuItem` per workspace
stops linking to `/workspaces/${w.id}`. Instead it calls a `setActive` mutation,
then on success invalidates active-scoped queries
(`page.listByWorkspace`, `page.listFavorites`, `chat.listChats`, etc.) and
`router.push('/app')` (+ `router.refresh()` so the server `(active)/layout`
re-resolves). "Создать пространство" stays `/workspaces/new`.

`sidebarSectionFromPathname` in `workspace-layout-client.tsx` already matches on
`/chats`, `/pages`, `/trash` substrings — works unchanged with neutral paths.
The `chatIdMatch` / `pageIdMatch` regexes match `/chats/<uuid>` / `/pages/<uuid>`
— also unchanged.

### 6. APIs (`apps/web`)

**Export:** add `app/api/pages/[pageId]/export/[format]/route.ts`:
- resolve session; load page by `pageId`; assert membership by
  `page.workspaceId` (reuse `domain.workspace.assertMembership`); export.
- Logic is the existing export route minus the `workspaceId` param.
Keep the old `app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]`
route as a `307` redirect to the new API after a membership check (or just leave
it working — both acceptable; redirect is cleaner). Update
`page-export-dialog.tsx` and `use-page-actions.tsx` to call the new URL.

**Attachment upload:** `/api/files/upload?kind=attachment` no longer requires
`workspaceId` in the query. For `kind=attachment`, the server calls
`resolveActiveWorkspace` (via a session-scoped helper, not tRPC ctx) to get the
workspace, then does the existing membership + storage-limit checks against it.
If no active workspace → `400`. Update callers to drop the `&workspaceId=...`:
`use-draft-attachments.ts`, `task-attachments.ts`, `lib/upload-handler.ts`.
Avatar (`profile-avatar-uploader.tsx`) is unchanged.

Since the upload route is a plain Next route (no tRPC ctx), extract the
resolution core of `resolveActiveWorkspace` into a function that takes
`(prisma, userId)` so both tRPC and the route can call it.

**Export link rewriting:** `server/page-export/embed-images.ts` rewrites internal
`<a href>` to absolute URLs; add `/pages/` alongside the existing `/workspaces/`
prefix so new-scheme page links in exported content also get absolutized.

### 7. `robots.ts`

`Disallow: '/workspaces/'` stays (still a real, redirecting path). Add
`'/pages/'`, `'/chats/'`, `'/templates/'`, `'/trash/'`, `'/app'` to keep the
authenticated app out of the index.

## Data flow

```
Browser hits /pages/{id}
  └─ (active)/layout: resolveActiveWorkspace(user) -> ws  (repairs pref if stale)
       └─ load page.listByWorkspace(ws.id) + features -> WorkspaceLayoutClient (sidebar)
  └─ pages/[pageId]/page: page.getById(id) -> {workspaceId, ...}
       ├─ page.workspaceId == ws.id -> render
       └─ != -> setActive(page.workspaceId); redirect('/pages/{id}')  (shell re-resolves)

Switcher: setActive(wId) -> invalidate active-scoped queries -> push('/app') + refresh

Legacy /workspaces/{wId}/pages/{pId}:
  assert member(wId); page.getById(pId); if page.workspaceId != wId -> notFound
  setActive(wId); redirect('/pages/{pId}')   (#hash preserved by browser)
```

## Error handling / safety

- Resource not found or no membership → `notFound()` (404), never a silent switch.
- Legacy URL whose `workspaceId` ≠ `resource.workspaceId` → `notFound()`.
- `setActive` for a non-member → `FORBIDDEN`.
- No workspace at all → `/workspaces/new`.
- Data isolation is unchanged: every tRPC list/mutation still asserts membership
  on the workspace it's given; `getById`/`getChat` already filter by membership.
  The active workspace is only a *default scope hint*, never an authorization.

## Testing

Unit (vitest / existing patterns):
- `resolveActiveWorkspace`: returns active when valid; falls back to default when
  active missing/stale; falls back to first workspace when default invalid;
  repairs the stored pref; returns null with no workspaces.
- `setActive`: rejects non-member (FORBIDDEN); writes pref for member.
- Active-scoped UI link helpers (`buildChatHref`, etc.) produce neutral URLs and
  never `/workspaces/{uuid}`.
- A guard test asserting no UI module emits `/workspaces/${...}` for
  pages/chats/templates/trash (grep-style or render assertion), mirroring the
  existing `packages/ui/test/chat-message-content.test.tsx` expectation — update
  that fixture's expected URL too.
- Export route: new `/api/pages/[pageId]/export/[format]` resolves + checks
  membership; legacy route redirects.

Route-level (RSC functions are async server fns; test by mocking trpc + redirect,
following existing test conventions, or via Playwright):
- `/pages/:id` switches active workspace when the page is in another accessible
  workspace.
- Legacy `/workspaces/:id/pages/:id` redirects to `/pages/:id`.
- `/app` redirects to first page or `/chats/new`.

E2E (`apps/e2e`): update helpers that navigate via `/workspaces/...` (the surface
map flagged `feedback_e2e_create_page_sidebar`); assert the address bar never
shows `/workspaces/{uuid}` during normal navigation.

Run focused tests first (`pnpm --filter @repo/trpc test`,
`pnpm --filter web test`), then `pnpm check-types` and `pnpm lint`.

## Acceptance criteria

- Normal authenticated navigation never shows `/workspaces/{workspaceId}`.
- Active workspace is persisted server-side per user and survives reload.
- Data isolation stays enforced by membership + `resource.workspaceId`.
- No domain/DB security boundary is weakened.
- Legacy links redirect safely (membership-checked) or fail safely (`notFound`).
