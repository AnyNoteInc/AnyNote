# Post-release fixes (v1.24.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 13 post-release bugs and small feature changes reported after v1.24.0.

**Architecture:** Edits span `apps/web` (App Router, MUI v6, tRPC client), `packages/trpc`, `packages/editor` (Tiptap), `packages/db` (seed), and `deploy/` (docs). Each item is independent except 8/9 (shared create-page menu) and 7 (sidebar). Verify with Playwright before merge.

**Tech Stack:** Next.js 16 / React 19, MUI v6, tRPC v11, Tiptap, @dnd-kit, Prisma 7, Traefik (deploy docs).

**Branch:** `fix/post-release-1.24` (worktree at `~/.config/superpowers/worktrees/anynote/post-release-1.24`).

**Working directory note:** all paths below are relative to the worktree root. Run all commands from the worktree root.

---

## Task 0: Commit the spec

**Files:**
- Already present: `docs/superpowers/specs/2026-06-15-post-release-fixes-design.md`
- Already present: `docs/superpowers/plans/2026-06-15-post-release-fixes.md`

- [ ] **Step 1: Commit spec + plan**

```bash
git add docs/superpowers/specs/2026-06-15-post-release-fixes-design.md docs/superpowers/plans/2026-06-15-post-release-fixes.md
git commit -m "docs: post-release v1.24 fixes spec + plan"
```

---

## Task 1: App user menu — show active workspace / create-space link

**Files:**
- Read first: `apps/web/src/components/app/app-user-menu.tsx`
- Read for pattern: `apps/web/src/components/workspace/workspace-user-menu.tsx` (the "Активное пространство" block)
- Modify: `apps/web/src/components/app/app-user-menu.tsx`
- Find the create-workspace route (grep `workspaces/new` or `create` under `apps/web/src/app`).

- [ ] **Step 1: Confirm where AppUserMenu is used and whether it has session/workspace data.**

Run: `grep -rn "AppUserMenu" apps/web/src`
Read `app-user-menu.tsx` fully. Determine if it already receives the session and can query `trpc.workspace.getActive` (it is a client component) or if the data must be passed by its parent (`public-header.tsx`). Decide based on what you find: if `AppUserMenu` is `"use client"` and inside a tRPC provider subtree, query `trpc.workspace.getActive.useQuery()`; otherwise pass `activeWorkspace` as a prop from the server parent.

NOTE: `AppUserMenu` is the **public header** menu. On the public/marketing pages the tRPC React provider is NOT mounted (only `(protected)` mounts it). So querying tRPC client-side there will fail. The robust approach is to pass the active workspace down as a prop from a Server Component (the header is rendered with `session`). Verify this in `public-header.tsx` and its parent before coding.

- [ ] **Step 2: Resolve active workspace where the header is rendered (server side).**

In the Server Component that renders `PublicHeader` (likely `apps/web/src/app/page.tsx` and any other public layout using it), fetch the active workspace when a session exists:

```tsx
import { getServerTRPC } from '@/trpc/server'
// ...
const session = await getSession()
let activeWorkspace: { id: string; name: string; icon: string | null } | null = null
let hasAnyWorkspace = false
if (session) {
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getActive().catch(() => null)
  if (ws) activeWorkspace = { id: ws.id, name: ws.name, icon: ws.icon ?? null }
  const mine = await trpc.workspace.listMine().catch(() => [])
  hasAnyWorkspace = mine.length > 0
}
```

Pass `activeWorkspace` and `hasAnyWorkspace` into `PublicHeader`, then into `AppUserMenu` as plain serializable props. (Confirm `workspace.getActive` and `workspace.listMine` exist in `packages/trpc/src/routers/workspace.ts` — they do per survey.)

- [ ] **Step 3: Render the workspace row / create-space link above Профиль in AppUserMenu.**

Add this just before the "Профиль" menu item (only when authenticated):

```tsx
{activeWorkspace ? (
  <MenuItem component={Link} href="/app">
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box sx={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {activeWorkspace.icon ?? '📒'}
      </Box>
      <Typography variant="body2" noWrap>{activeWorkspace.name}</Typography>
    </Box>
  </MenuItem>
) : session ? (
  <MenuItem component={Link} href="/app">
    <Typography variant="body2">Создать пространство</Typography>
  </MenuItem>
) : null}
<Divider />
```

Confirm the actual create-space destination (Step 1 grep). If `/app` already routes a no-workspace user into an onboarding/create flow, `/app` is correct; otherwise use the discovered route. Import `Link`, `Box`, `Typography`, `MenuItem`, `Divider` from `@repo/ui/components` (match existing imports in the file).

- [ ] **Step 4: Type-check.**

Run: `pnpm --filter web check-types 2>&1 | tail -20`
Expected: no new errors. (If stale `.next/types` errors about deleted routes appear, `rm -rf apps/web/.next/types` and retry.)

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/app/app-user-menu.tsx apps/web/src/components/public/public-header.tsx apps/web/src/app/page.tsx
git commit -m "feat(web): show active workspace / create-space link in app user menu"
```

---

## Task 2: Profile page — "Перейти" switches workspace

**Files:**
- Read: `apps/web/src/app/(protected)/profile/page.tsx` (Server Component, ~line 106-142)
- Read for pattern: `apps/web/src/components/workspace/workspace-sidebar.tsx:100-111` (`setActive` usage)
- Create: `apps/web/src/components/profile/switch-workspace-button.tsx`
- Modify: `apps/web/src/app/(protected)/profile/page.tsx`

- [ ] **Step 1: Create the client switch button.**

`apps/web/src/components/profile/switch-workspace-button.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'

import { Button } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

export function SwitchWorkspaceButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const setActive = trpc.workspace.setActive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.page.listByWorkspace.invalidate(),
        utils.page.listFavorites.invalidate(),
        utils.chat.listChats.invalidate(),
        utils.workspace.getActive.invalidate(),
      ])
      router.push('/app')
      router.refresh()
    },
  })
  return (
    <Button
      size="small"
      variant="outlined"
      disabled={setActive.isPending}
      onClick={() => setActive.mutate({ workspaceId })}
    >
      Перейти
    </Button>
  )
}
```

- [ ] **Step 2: Replace the `<Link href="/app">` button in profile page.**

In `apps/web/src/app/(protected)/profile/page.tsx`, replace the existing per-workspace `<Link href="/app"><Button>Перейти</Button></Link>` with `<SwitchWorkspaceButton workspaceId={w.id} />`. Add the import:

```tsx
import { SwitchWorkspaceButton } from '@/components/profile/switch-workspace-button'
```

Verify the profile page is inside `(protected)` (it is) so the tRPC React provider is mounted — the client mutation will work.

- [ ] **Step 3: Type-check.**

Run: `pnpm --filter web check-types 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/components/profile/switch-workspace-button.tsx apps/web/src/app/(protected)/profile/page.tsx
git commit -m "fix(web): profile 'Перейти' switches active workspace before navigating"
```

---

## Task 3: Notifications page — inherit the workspace toolbar

**Files:**
- Move: `apps/web/src/app/(protected)/notifications/page.tsx` → `apps/web/src/app/(protected)/(active)/notifications/page.tsx`
- Read: `apps/web/src/app/(protected)/(active)/layout.tsx` (to confirm it wraps with `WorkspaceLayoutClient`)
- Check breadcrumb logic in `apps/web/src/components/workspace/workspace-layout-client.tsx` / `workspace-toolbar.tsx`

- [ ] **Step 1: Confirm the `(active)` layout provides the toolbar and requires an active workspace.**

Read `apps/web/src/app/(protected)/(active)/layout.tsx`. Confirm it calls `trpc.workspace.getActive()` and renders `WorkspaceLayoutClient` (toolbar + sidebar). Confirm a user with no active workspace is handled (redirect) — notifications under `(active)` will then require a workspace, which is acceptable (the toolbar is workspace chrome). If the layout hard-redirects users with no workspace, that matches the app's model.

- [ ] **Step 2: Move the route file into the `(active)` group.**

```bash
mkdir -p apps/web/src/app/(protected)/\(active\)/notifications
git mv apps/web/src/app/\(protected\)/notifications/page.tsx apps/web/src/app/\(protected\)/\(active\)/notifications/page.tsx
rmdir apps/web/src/app/\(protected\)/notifications 2>/dev/null || true
```

(Route groups `(active)`/`(protected)` don't change the URL — `/notifications` still resolves.)

- [ ] **Step 3: Confirm breadcrumb renders sensibly for `/notifications`.**

Read how `WorkspaceToolbar` builds breadcrumbs (it keys off page chains). For a non-page route like `/notifications`, ensure it doesn't crash — it likely shows just the workspace root. If the toolbar needs a title for this route, add a minimal breadcrumb label "Уведомления" only if the existing toolbar supports per-route titles; otherwise leave the default workspace breadcrumb. Do not over-engineer.

- [ ] **Step 4: Type-check + clear stale route types.**

Run: `rm -rf apps/web/.next/types && pnpm --filter web check-types 2>&1 | tail -20`
Expected: no errors about the moved route.

- [ ] **Step 5: Commit.**

```bash
git add -A apps/web/src/app
git commit -m "fix(web): move /notifications under (active) so it gets the workspace toolbar"
```

---

## Task 4: Integrations — keep only Telegram

**Files:**
- Read: `apps/web/src/app/(protected)/settings/integrations/page.tsx`
- Read: `packages/trpc/src/routers/integration.ts` (`listProviders`)
- Modify: `packages/trpc/src/routers/integration.ts` OR the page, to filter to implemented providers
- Modify: `packages/db/prisma/seed.ts` (remove unimplemented provider seeds)
- Test: `packages/trpc/test/` (add/adjust if a provider-list test exists)

- [ ] **Step 1: Decide filter location.**

Read `integration.ts` `listProviders`. Add a server-side allowlist constant of implemented provider keys and filter the query result by it. Implemented set = Telegram only. Concretely, identify the provider's stable key field (e.g. `key`/`slug`/`name`) in the `IntegrationProvider` model and filter on it.

```ts
// packages/trpc/src/routers/integration.ts
const IMPLEMENTED_PROVIDER_KEYS = ['telegram'] as const // adjust to the real key casing in DB
```

Then in `listProviders`, after fetching, `return providers.filter(p => IMPLEMENTED_PROVIDER_KEYS.includes(p.key.toLowerCase() as ...))` — match the actual field. If Telegram is NOT represented as an `IntegrationProvider` row (it uses the dedicated `TelegramLinkCard`, not the generic card), then the correct outcome is `listProviders` returns an **empty array**, and the integrations page shows only the `TelegramLinkCard`. Confirm which is true by reading the page (does it map `providers` to `IntegrationCard`, and is Telegram a provider row or a separate card?). Per survey: Telegram is a separate `TelegramLinkCard`; the generic providers are the stubs. So the likely correct change is: filter generic providers to the implemented allowlist (which may be empty), keeping the dedicated Telegram card.

- [ ] **Step 2: Update the page to not render an empty generic grid.**

In `settings/integrations/page.tsx`, if `providers.length === 0`, render only the `TelegramLinkCard` and omit the generic grid / "no integrations" filler. Keep the page heading.

- [ ] **Step 3: Remove unimplemented provider seeds.**

In `packages/db/prisma/seed.ts`, find the block that seeds `IntegrationProvider` rows (Yandex, GitHub, Telegram, AmoCRM, MangoOffice). Remove the rows for GitHub, Yandex, AmoCRM, MangoOffice. Keep Telegram **only if** it is actually represented as a provider row used by working code; if Telegram is not a generic provider row, remove all generic-provider seeds. Leave the `IntegrationProvider`/`Integration` tables in the schema (no migration).

- [ ] **Step 4: Type-check trpc + db.**

Run: `pnpm --filter @repo/trpc check-types 2>&1 | tail -20 && pnpm --filter @repo/db check-types 2>&1 | tail -20`
Expected: no errors.

- [ ] **Step 5: Run trpc tests.**

Run: `pnpm --filter @repo/trpc test 2>&1 | tail -20`
Expected: pass. If a test asserts the old provider list, update it to the implemented set.

- [ ] **Step 6: Commit.**

```bash
git add packages/trpc/src/routers/integration.ts apps/web/src/app/\(protected\)/settings/integrations/page.tsx packages/db/prisma/seed.ts
git commit -m "feat(integration): show only implemented (Telegram) integration on settings page"
```

---

## Task 5: api.anynote.ru TLS — verify & document

**Files:**
- Read: `deploy/traefik/dynamic/routers.yml` (api router), `deploy/traefik/traefik.yml` (ACME resolver `le`)
- Read: `.github/workflows/deploy.yml` (ACME email, traefik sync)
- Create/Modify: `deploy/README.md` (add a "TLS for api.anynote.ru" runbook section)

- [ ] **Step 1: Re-verify the api router matches the secured pattern.**

Read `deploy/traefik/dynamic/routers.yml`. Confirm the `api` router: `rule: Host(`api.anynote.ru`)`, `entryPoints: [websecure]`, `tls.certResolver: le`, `service: engines`, and middlewares match the `anynote.ru` web router pattern. Confirm `traefik.yml` has the `le` resolver with `httpChallenge.entryPoint: web` and ACME storage. Note any discrepancy; fix only if the api router deviates from the working pattern.

- [ ] **Step 2: Write the runbook.**

Append (or create) `deploy/README.md` with a clear section:

```markdown
## TLS certificate for api.anynote.ru

The Traefik router for `api.anynote.ru` is already configured in
`deploy/traefik/dynamic/routers.yml` (entryPoint `websecure`, `tls.certResolver: le`,
service `engines`) using the same Let's Encrypt HTTP-01 resolver (`le`) as
`anynote.ru`. No application/Traefik config change is required to enable HTTPS.

To actually issue the certificate:

1. **DNS:** add an A record `api.anynote.ru` → the Traefik host IP (the same IP as
   `anynote.ru`). Let's Encrypt HTTP-01 needs the name to resolve to the host.
2. **Deploy:** trigger the deploy workflow (push a release tag or
   `gh workflow run deploy.yml --ref main`). The deploy syncs `deploy/traefik/`
   and runs `docker compose up -d`; Traefik then performs the ACME HTTP-01
   challenge on port 80 and issues the cert into `/letsencrypt/acme.json`.
3. **Verify:**
   - `curl -I https://api.anynote.ru` → a valid TLS response (200/404/502, not an
     SSL error).
   - `docker compose logs traefik | grep -i acme` → certificate obtained for
     `api.anynote.ru`.
   - Renewal is automatic (~30 days before expiry).

Prerequisite secret already wired: `ACME_EMAIL` (GitHub secret →
`TRAEFIK_CERTIFICATESRESOLVERS_LE_ACME_EMAIL`).
```

- [ ] **Step 3: Commit.**

```bash
git add deploy/README.md
git commit -m "docs(deploy): runbook for issuing api.anynote.ru TLS certificate"
```

---

## Task 6: API key expiry — Select + "Бессрочный"

**Files:**
- Modify: `apps/web/src/components/settings/api-key-create-dialog.tsx:58-67`
- Modify: `apps/web/src/components/settings/api-keys-section.tsx:49` (display text)
- Test: existing web tests if any cover this dialog

- [ ] **Step 1: Replace RadioGroup with Select.**

In `api-key-create-dialog.tsx`, replace the `FormControl`/`RadioGroup` block with:

```tsx
<FormControl fullWidth size="small">
  <InputLabel id="api-key-ttl-label">Срок действия</InputLabel>
  <Select
    labelId="api-key-ttl-label"
    label="Срок действия"
    value={ttl}
    onChange={(e) => setTtl(e.target.value as Ttl)}
  >
    <MenuItem value="7d">7 дней</MenuItem>
    <MenuItem value="30d">30 дней</MenuItem>
    <MenuItem value="90d">90 дней</MenuItem>
    <MenuItem value="1y">1 год</MenuItem>
    <MenuItem value="never">Бессрочный</MenuItem>
  </Select>
</FormControl>
```

Update imports: replace `RadioGroup, FormControlLabel, Radio, FormLabel` with `Select, MenuItem, InputLabel` from `@repo/ui/components` (keep `FormControl`). If any of these aren't re-exported, add them to `packages/ui/src/components/index.ts`. Keep the `Ttl` type and `'never'` value unchanged.

- [ ] **Step 2: Update display text in api-keys-section.tsx.**

Change the lowercase "никогда" display to "Бессрочно" (the past/listing label for a perpetual key). Find the exact ternary at line ~49 and update the `'never'` branch's label.

- [ ] **Step 3: Verify Select components are exported from @repo/ui.**

Run: `grep -n "Select\|MenuItem\|InputLabel" packages/ui/src/components/index.ts`
If missing, add explicit re-exports.

- [ ] **Step 4: Type-check + lint web + ui.**

Run: `pnpm --filter web check-types 2>&1 | tail -10 && pnpm --filter @repo/ui check-types 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/settings/api-key-create-dialog.tsx apps/web/src/components/settings/api-keys-section.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): API key expiry uses a Select; 'Никогда' → 'Бессрочный'"
```

---

## Task 7: Sidebar overhaul — unified scroll, first-level tree, drag-and-drop

This is the largest item. Build it incrementally with commits per sub-step. Read all sidebar files first:
`workspace-sidebar.tsx`, `favorites-section.tsx`, `page-tree-section.tsx`, `shared-pages-section.tsx`, `types.ts`, `page-context-menu.tsx`, `use-page-actions.tsx`.

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`
- Modify: `apps/web/src/components/workspace/favorites-section.tsx`
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx`
- Possibly create: `apps/web/src/components/workspace/sidebar-drop-zone.tsx` (droppable wrapper for Archive/Trash links)
- Relevant tRPC: `page.addFavorite`, `page.removeFavorite`, `page.moveToCollection`, `page.archive`, `page.softDelete`, `page.reorder`, `page.reorderFavorites` (all confirmed to exist)

### 7a: Single scroll container

- [ ] **Step 1: Remove nested scroll regions.**

In `favorites-section.tsx` remove `maxHeight: 200, overflow: 'auto'` from its inner `Stack`. In `page-tree-section.tsx` remove the inner `overflow: 'auto'` / `flex:1, minHeight:0` scroll on the tree `Box`. In `shared-pages-section.tsx` remove its `maxHeight: 200, overflow: 'auto'`. Keep the single outer scroll in `workspace-sidebar.tsx` (`overflow: 'auto'` on the aside) so the entire pages area scrolls as one.

- [ ] **Step 2: Verify visually.**

Run dev server (see "Running the app" at bottom). Confirm sections scroll together, not independently. (Verified more rigorously in the Playwright task.)

- [ ] **Step 3: Commit.**

```bash
git add apps/web/src/components/workspace/favorites-section.tsx apps/web/src/components/workspace/page-tree-section.tsx apps/web/src/components/workspace/shared-pages-section.tsx
git commit -m "fix(web): single scroll region for the pages sidebar"
```

### 7b: Favorites / Команда / Личное as first-level tree roots; pinned collections below

- [ ] **Step 4: Restructure workspace-sidebar pages section.**

In `workspace-sidebar.tsx`, render (in order) three collapsible top-level roots:
1. "Избранное" (wraps `FavoritesSection` content)
2. "Команда" (wraps the TEAM `PageTreeSection`)
3. "Личное" (wraps the PERSONAL `PageTreeSection`)

Each root is a row with a chevron toggle (reuse the chevron/collapse pattern already in `page-tree-section.tsx`). Below these three, render pinned collections as additional top-level roots (not as separate boxed sections). Keep `SharedPagesSection`/guest pages where they currently are unless they belong under one of the roots — leave shared/guest as-is to limit scope. The key visual change: the three roots and the pinned collections share one indentation level and one scroll.

For pinned collections: `trpc.collection.list` returns collections with a `position` field; render the collections that are "pinned" (if there's a `pinned`/`isPinned` flag use it; otherwise per survey there is only `position` and no pin UI — in that case render all non-default collections as roots below Личное, matching "прикрепленные коллекции … ниже"). Confirm by reading `collection.list` output shape before coding; do not invent a `pinned` field that doesn't exist.

- [ ] **Step 5: Type-check.**

Run: `pnpm --filter web check-types 2>&1 | tail -10`

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx apps/web/src/components/workspace/favorites-section.tsx apps/web/src/components/workspace/page-tree-section.tsx
git commit -m "feat(web): favorites/team/personal as first-level sidebar tree roots, pinned collections below"
```

### 7c: Drag-and-drop drop zones

- [ ] **Step 7: Wrap the pages sidebar in one shared @dnd-kit DndContext.**

Today favorites and the trees each have their own `DndContext`. To support cross-section drops, hoist a single `DndContext` to the pages-section container in `workspace-sidebar.tsx`. Each draggable page row keeps a `useSortable`/`useDraggable` id namespaced by section (e.g. `page:{id}`). Add `useDroppable` zones with stable ids:
- `zone:favorites`
- `zone:team`
- `zone:private`
- `zone:archive`
- `zone:trash`

Make the Archive and Trash links droppable (highlight on `isOver`). Reuse existing within-tree reorder by checking the drop target id in `onDragEnd`.

- [ ] **Step 8: Implement onDragEnd routing.**

In the hoisted `onDragEnd`, read `active.id` (a `page:{pageId}`) and `over.id`:

```ts
const pageId = String(active.id).replace('page:', '')
const over = String(event.over?.id ?? '')
if (over === 'zone:favorites') addFavorite.mutate({ pageId })
else if (over === 'zone:team') moveToCollection.mutate({ pageId, workspaceId, target: 'team' })
else if (over === 'zone:private') moveToCollection.mutate({ pageId, workspaceId, target: 'private' })
else if (over === 'zone:archive') archive.mutate({ id: pageId, workspaceId })
else if (over === 'zone:trash') softDelete.mutate({ id: pageId, workspaceId })
else { /* fall through to existing within-tree / within-favorites reorder */ }
```

Wire the mutations with the same cache-invalidation the sections already use (favorites list, page list). Confirm exact procedure input shapes from `packages/trpc/src/routers/page.ts` (survey: `addFavorite {pageId}`, `moveToCollection {pageId, workspaceId, target}`, `archive {id, workspaceId}`, `softDelete {id, workspaceId}`). Preserve existing reorder behavior for drops that land within a tree/favorites list (over a page row, not a zone).

- [ ] **Step 9: Type-check + web tests.**

Run: `pnpm --filter web check-types 2>&1 | tail -10 && pnpm --filter web test 2>&1 | tail -15`
Expected: type-check clean; tests pass (update any sidebar unit test that breaks from the restructure).

- [ ] **Step 10: Commit.**

```bash
git add apps/web/src/components/workspace
git commit -m "feat(web): sidebar drag-and-drop — favorite/move/archive/trash drop zones"
```

---

## Task 8 & 9: Dashboard + "Загрузить встречу" in the "+" create menu

**Files:**
- Read: `apps/web/src/components/templates/create-page-dialog.tsx`, `page-type-registry.tsx`
- Read: `apps/web/src/components/workspace/page-tree-section.tsx` (current Dashboard/Meeting buttons ~268-280, 389-411)
- Read: `apps/web/src/components/meeting/MeetingUploadDialog.tsx`
- Modify: `page-type-registry.tsx`, `create-page-dialog.tsx`, `page-tree-section.tsx`

- [ ] **Step 1: Add Дашборд + Встреча as selectable entries.**

In `page-type-registry.tsx`, the create grid is driven by `CREATABLE_PAGE_TYPES`; DASHBOARD/MEETING are in `NON_CREATABLE_PAGE_TYPE_META`. Add DASHBOARD and MEETING to the create flow. Because their creation isn't a plain `page.create` (Dashboard = `dashboard.create`; Meeting = upload dialog), add them as entries with a custom action rather than the default type-create. Introduce an optional `onSelect`/action discriminator for these two entries, or handle them specially in `create-page-dialog.tsx`'s selection handler:

```tsx
// in create-page-dialog selection handler
if (type === 'DASHBOARD') { createDashboard() ; return }
if (type === 'MEETING') { openMeetingUpload() ; return }
// else default create-by-type
```

- [ ] **Step 2: Wire Dashboard create from the dialog.**

Move the `trpc.dashboard.create` call (currently in `page-tree-section.tsx`) into the create dialog (or a shared hook). On success navigate to `/pages/{id}` exactly as today. Reuse the existing mutation — do not change its server contract.

- [ ] **Step 3: Wire Meeting upload from the dialog.**

Selecting "Загрузить встречу" opens the existing `MeetingUploadDialog`. Render `MeetingUploadDialog` controlled by state owned where the create dialog lives, opening it when the meeting entry is chosen. Preserve the `meetingsEnabled` plan flag: hide/disable the meeting entry when the flag is off (read how the current sidebar button gates it and replicate).

- [ ] **Step 4: Remove the duplicate sidebar toolbar buttons.**

In `page-tree-section.tsx`, remove the standalone Dashboard and Meeting toolbar buttons now that both are in the "+" menu. Keep the "+" entry point pointing at the unified create menu.

- [ ] **Step 5: Type-check + web tests.**

Run: `pnpm --filter web check-types 2>&1 | tail -10 && pnpm --filter web test 2>&1 | tail -15`
Expected: clean; update any test referencing the removed buttons.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/templates apps/web/src/components/workspace/page-tree-section.tsx apps/web/src/components/meeting
git commit -m "feat(web): create dashboards and upload meetings from the unified '+' menu"
```

---

## Task 10: Date/time picker — make time editable

**Files:**
- Modify: `packages/editor/src/components/date-picker-body.tsx`
- Read: `packages/editor/src/extensions/date.tsx`
- Check `@repo/ui/components` exports for time pickers (`DigitalClock`/`MultiSectionDigitalClock`/`TimeField`/`StaticDateTimePicker`)

- [ ] **Step 1: Reproduce in the running app FIRST.**

Run dev server, insert a "дата и время" node (datetime kind), open the picker, try to change the time. Confirm the time UI is missing/non-functional in the current `displayStaticWrapperAs="desktop"` `StaticDateTimePicker`. Note exactly what's shown (calendar only? clock present but inert?). This guides the fix.

- [ ] **Step 2: Make the datetime branch expose a working time control.**

Preferred approach: render the date and time side-by-side using components that work in a static/inline popover. Replace the datetime branch with a `StaticDatePicker` plus a time control bound to the same `value`:

```tsx
{mode === 'datetime' ? (
  <Stack>
    <StaticDatePicker
      key="datetime-date"
      value={value}
      onChange={(d) => {
        if (!d) { onChange(null); return }
        const next = new Date(value ?? d)
        next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
        onChange(next)
      }}
      displayStaticWrapperAs="desktop"
      slotProps={{ actionBar: { actions: [] } }}
    />
    <Box sx={{ px: 2, pb: 1 }}>
      <TimeField
        label="Время"
        value={value}
        onChange={(t) => {
          if (!t) return
          const next = new Date(value ?? t)
          next.setHours(t.getHours(), t.getMinutes(), 0, 0)
          onChange(next)
        }}
        ampm={false}
        fullWidth
        size="small"
      />
    </Box>
  </Stack>
) : ( /* StaticDatePicker date-only branch unchanged */ )}
```

Confirm `TimeField`, `Stack`, `Box` are exported from `@repo/ui/components`; if `TimeField` isn't, add the re-export (it's a `@mui/x-date-pickers` component). If `TimeField` proves awkward in the popover, an acceptable alternative is `MultiSectionDigitalClock` bound the same way. The invariant: changing the time updates `value`'s `HH:mm`, and `accept(value)` persists it.

- [ ] **Step 3: Verify the saved value carries the time.**

Reproduce again: pick a date + a non-zero time, save, confirm the rendered label shows the chosen time (via `formatIsoForDisplay(..., 'datetime')`).

- [ ] **Step 4: Type-check editor + web.**

Run: `pnpm --filter @repo/editor check-types 2>&1 | tail -10 && pnpm --filter web check-types 2>&1 | tail -10`
(Editor uses `moduleResolution: Bundler`; extensionless relative imports — match existing style.)

- [ ] **Step 5: Commit.**

```bash
git add packages/editor/src/components/date-picker-body.tsx packages/ui/src/components/index.ts
git commit -m "fix(editor): datetime node — make time selectable, not just date"
```

---

## Task 11: Synced block — reproduce, find root cause, fix

**Files:**
- Read: `packages/editor/src/extensions/synced-block.tsx`, `synced-block-nested-editor.tsx`
- Read: `apps/web/src/components/page/synced-block-embed.tsx`
- Read: `packages/trpc/src/routers/synced-block.ts`
- Read: yjs server access gate (`apps/yjs` / `@repo/yjs-server`, `canAccessSyncedBlock`)
- Read: how `renderSyncedBlock` is injected into the editor (grep `renderSyncedBlock`)

- [ ] **Step 1: Reproduce in the running app (REQUIRED — no speculative fix).**

Use systematic-debugging. With the dev server + a real yjs server running (the editor needs Hocuspocus; note E2E has no yjs, so reproduce manually with `pnpm --filter @repo/yjs-server dev`), create a synced block, copy/reference it on a second page, and observe. Capture: the `trpc.syncedBlock.getById` result (network), browser console errors, and yjs connection status for `syncedBlock:{id}`. Identify which of these is the failure: getById returns `no_access`/`deleted`/`unsynced`; nested provider fails to connect (token/audience); renderer not injected; content never seeded.

- [ ] **Step 2: Form a single hypothesis and confirm it.**

Based on Step 1 evidence, state the one root cause. Confirm by inspecting the responsible code path (e.g., if `getById` denies access, trace `resolveOriginAccess`; if the nested provider 401s, check the yjs token audience like the known `BETTER_AUTH_JWT_AUDIENCE` gotcha; if renderer missing, check the editor extension wiring in `apps/web`).

- [ ] **Step 3: Fix the root cause + add a regression assertion.**

Make the minimal fix. Add a test at the appropriate layer (tRPC test for an access bug; a unit test for a wiring bug; or document that it's only reproducible in-app and rely on the Playwright check).

- [ ] **Step 4: Verify the fix in-app.**

Repeat Step 1 reproduction; confirm the synced block now renders editable / propagates edits.

- [ ] **Step 5: Type-check affected packages + commit.**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter web check-types && pnpm --filter @repo/trpc check-types` (whichever were touched).

```bash
git add -A
git commit -m "fix(synced-block): <root cause one-liner>"
```

> If Step 1 shows the synced block actually works, STOP and report that finding instead of inventing a fix. Document what was tested.

---

## Task 12: Page-title hover — visible add-icon/add-cover buttons

**Files:**
- Modify: `apps/web/src/components/page/page-header.tsx` (`ghostButtonSx` ~40-46; reveal ~161)

- [ ] **Step 1: Reproduce the invisibility.**

Run dev server, open a page with no icon/cover, hover the title. Observe the "Добавить иконку"/"Добавить обложку" buttons in **light** theme — confirm they're effectively invisible (low-contrast text).

- [ ] **Step 2: Fix the ghost button color/contrast.**

The buttons reveal via `opacity: 0 → 1` on hover but use `color: 'text.secondary'`. Ensure a clearly visible, theme-aware color on reveal/hover. Update `ghostButtonSx`:

```tsx
const ghostButtonSx = {
  color: 'text.secondary',
  textTransform: 'none',
  opacity: 0,
  transition: 'opacity .15s, color .15s',
  '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
  '&:focus-visible': { opacity: 1 },
} as const
```

The reveal stays driven by the parent `'&:hover .page-header__add-action': { opacity: 1 }`. The point is the text must contrast against the page background in both themes (`text.secondary`/`text.primary` are theme palette tokens, so they're correct in light AND dark — verify the actual reported invisibility isn't caused by something else, e.g. the buttons sitting over a same-color element; if so, fix that specifically). Confirm in BOTH themes.

- [ ] **Step 3: Confirm both affordances work.**

Hover → both buttons visible; click "Добавить иконку" opens the icon picker; click "Добавить обложку" opens the cover picker. (Item 12's "add icon / add cover" sub-points are these existing buttons; ensure they function.)

- [ ] **Step 4: Type-check + commit.**

Run: `pnpm --filter web check-types 2>&1 | tail -10`

```bash
git add apps/web/src/components/page/page-header.tsx
git commit -m "fix(web): make page-title hover add-icon/add-cover buttons visible in light theme"
```

---

## Task 13: Cover spans full content-area width, flush under breadcrumbs

**Files:**
- Modify: `apps/web/src/app/(protected)/(active)/pages/[pageId]/page.tsx:55-68`
- Modify: `apps/web/src/components/page/page-header.tsx` (split cover out of the column)
- Read: `apps/web/src/components/page/cover-band.tsx`, `column-sx.ts`

- [ ] **Step 1: Lift the cover out of the 809px column.**

Today `PageHeader` (cover + icon + title) is wrapped in the `pageColumnSx` (`maxWidth: 809px`, `px: 48px`, `pt: 4`). Restructure so the cover renders full-width (page area width) while title/icon/body stay in the column. Options:
- (a) Split `PageHeader` into `PageCover` (full-bleed) + `PageTitleBlock` (in column), rendering `PageCover` first in `page.tsx` outside the column box.
- (b) Keep `PageHeader` but have it render the cover with negative horizontal margins that cancel the column padding and stretch to the page width.

Prefer (a) for clarity. In `page.tsx`:

```tsx
{!isFullBleed && (
  <>
    <PageCover id={page.id} workspaceId={page.workspaceId}
      initialCoverUrl={page.coverUrl} initialCoverPreset={page.coverPreset} />
    <Box className={PAGE_COLUMN_CLASS} sx={{ ...pageColumnSx, pt: page.coverUrl || page.coverPreset ? 1 : 4, pb: 1 }}>
      <PageTitleBlock id={page.id} workspaceId={page.workspaceId}
        initialTitle={page.title} initialIcon={page.icon}
        initialCoverUrl={page.coverUrl} initialCoverPreset={page.coverPreset} />
    </Box>
  </>
)}
```

`PageCover` renders the `CoverBand` with `rounded={false}`, full width, no top margin/padding (flush under the toolbar/breadcrumbs which sit above this scroll content), and still carries the change/remove cover actions. It shares the same `trpc.page.getById`/`update` wiring (extract the mutation/query into a small shared hook, or have `PageCover` own its own query like `PageHeader` does). The icon's Notion-style overlap (`mt: '-36px'`) must still work — keep the icon in `PageTitleBlock` and adjust its negative margin so it overlaps the now-full-width cover's bottom edge within the column.

- [ ] **Step 2: Keep the title's "add cover/icon" flow consistent.**

The "Добавить обложку"/"Сменить обложку"/"Убрать обложку" affordances continue to work. If `PageCover` is shown, the "Добавить обложку" ghost button (from Task 12) is hidden (cover exists); "Сменить/Убрать" live on the cover (as today). Avoid duplicating cover state across two components — share one `update` mutation + `getById` query (extract a `usePageHeaderState(id, workspaceId, initial...)` hook if it reduces duplication; DRY).

- [ ] **Step 3: Verify width + flush.**

Run dev server, set a cover. Confirm the cover is wider than the 809px text column (spans the page content area between sidebar and window edge) and has no gap between the breadcrumb bar and the cover top.

- [ ] **Step 4: Type-check + web tests.**

Run: `pnpm --filter web check-types 2>&1 | tail -10 && pnpm --filter web test 2>&1 | tail -15`
Expected: clean; update any page-header test (e.g. `kanban-board-page-editable`, cover tests) that depends on the old structure.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/app apps/web/src/components/page
git commit -m "feat(web): page cover spans full content width, flush under breadcrumbs"
```

---

## Task 14: Playwright verification of all items

**Files:**
- Read: `apps/e2e/helpers/auth.ts` (`signUpAndAuthAs`, `writeConsentsForUserId`)
- Read existing specs for patterns: `apps/e2e/*.spec.ts`
- Create: `apps/e2e/post-release-fixes.spec.ts` (or extend existing specs per area)

- [ ] **Step 1: Write specs per item.**

Create `apps/e2e/post-release-fixes.spec.ts` using `signUpAndAuthAs`. Cover (one `test` per item, skipping the infra-only #5 and treating #11 per its reproduction outcome):
- #1 home user menu shows active workspace / create-space link
- #2 profile "Перейти" switches workspace (needs 2 workspaces)
- #3 `/notifications` shows the workspace toolbar
- #4 `/settings/integrations` shows only Telegram
- #6 API key dialog Select shows "Бессрочный"
- #7 sidebar: single scroll; roots first-level; drag → favorite/move/archive/trash (use `el.evaluate`/manual pointer per the repo's DnD learning — neither `.click()` nor `force:true` reliably hits dnd handles)
- #8/#9 "+" menu offers Дашборд + Загрузить встречу
- #10 datetime node time is selectable and persists
- #12 title hover buttons visible + clickable
- #13 cover spans wider than the text column

For editor-dependent specs (#10, #11, #12, #13), recall E2E has no yjs server — assert in-document/decoration behavior before any reload; tRPC-backed UI after. Use the established create-page flow (Страницы section → wait `/chats` redirect → Новая страница).

- [ ] **Step 2: Run the new spec warm (retry to warm cold compile).**

Run: `pnpm exec playwright test apps/e2e/post-release-fixes.spec.ts --retries=1 2>&1 | tail -40`
(Requires `docker compose up -d`. The Playwright config runs its own dev server on 3100.)
Expected: all written tests pass (after attempt-1 warms the server).

- [ ] **Step 3: Fix any real failures, re-run until green.**

Iterate. Distinguish real bugs from cold-compile flake (a spec that fails at signUp on attempt 1 then passes on retry is flake, not a bug).

- [ ] **Step 4: Commit.**

```bash
git add apps/e2e/post-release-fixes.spec.ts
git commit -m "test(e2e): verify post-release v1.24 fixes"
```

---

## Task 15: Full gates + finish

- [ ] **Step 1: Run full gates.**

Run: `pnpm gates 2>&1 | tail -40`
Expected: check-types + lint + build + test all pass. Shared changes (tRPC `integration`, sidebar, db seed) can break engines/web — fix anything red. Watch the `GATES_EXIT` line; a wrapper exit can mask turbo failures.

- [ ] **Step 2: Address any failures, re-run gates until green.**

- [ ] **Step 3: Hand off to finishing-a-development-branch.**

Use superpowers:finishing-a-development-branch to present merge options.

---

## Running the app (for in-app verification)

From the worktree root (root `.env` is symlinked):
```bash
docker compose up -d                          # postgres, minio, qdrant, gotenberg
# source the env into the shell (next dev won't auto-load the root .env symlink)
set -a; . ./.env; set +a
pnpm --filter web dev                         # http://localhost:3000
pnpm --filter @repo/yjs-server dev            # needed for editor collab / synced block (#11)
```

## Self-review notes (coverage)

- Items 1–13 each map to Tasks 1–13; 8&9 share Task 8/9; #5 is docs-only; #11 is reproduce-first.
- Playwright verification (user requirement) = Task 14.
- Full gates before merge = Task 15.
