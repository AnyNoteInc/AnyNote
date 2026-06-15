# Post-release fixes (v1.24.0) — design

Date: 2026-06-15
Branch: `fix/post-release-1.24`

This spec collects 13 post-release bug fixes and small feature changes reported
after the v1.24.0 release. They are independent except for items 8/9 (shared
create-page menu) and item 7 (sidebar overhaul). Every item is verified with
Playwright before merge.

The codebase locations below were established by a read-only survey; line numbers
are indicative and may drift.

---

## 1. App user menu: show active workspace / "create space" link

**Where:** `apps/web/src/components/app/app-user-menu.tsx` (public-header user menu).

**Now:** The workspace user menu (`workspace-user-menu.tsx`) already shows the
active workspace under "Активное пространство". The public/home `AppUserMenu`
does **not** — it only shows auth links.

**Change:** Above the "Профиль" entry in `AppUserMenu`, render the currently
active workspace (icon + name) when one exists, linking to `/app`. When the user
has **no** workspace, render a "Создать пространство" link instead (to the
existing create-workspace route). The active workspace comes from
`trpc.workspace.getActive` / `resolveActiveWorkspace`; "create space" target is
the existing workspace-create entry point.

**Test:** Playwright — open the home-page user menu as an authenticated user,
assert the active-workspace row is present and links to `/app`.

---

## 2. Profile page: "Перейти" actually switches workspace

**Where:** `apps/web/src/app/(protected)/profile/page.tsx:136` (Server Component).

**Now:** The workspace card's "Перейти" button is a plain `<Link href="/app">`.
It navigates to `/app` showing the *currently active* workspace, never switching.

**Change:** Extract the per-workspace "Перейти" button into a small Client
Component that calls `trpc.workspace.setActive.mutate({ workspaceId })`, then on
success invalidates the same query set the sidebar uses
(`page.listByWorkspace`, `page.listFavorites`, `chat.listChats`,
`workspace.getActive`) and `router.push('/app'); router.refresh()`. This mirrors
the proven pattern in `workspace-sidebar.tsx`.

**Test:** Playwright — with two workspaces, click "Перейти" on the non-active
one, assert `/app` now reflects that workspace.

---

## 3. Notifications page: add the toolbar

**Where:** `apps/web/src/app/(protected)/notifications/page.tsx`.

**Now:** `/notifications` lives under `(protected)/` (not `(protected)/(active)/`),
so it does not get `WorkspaceLayoutClient` → no top toolbar; it renders a bare
`<Container>` + `<NotificationsList>`.

**Change:** Move `/notifications` under the `(protected)/(active)/` route group so
it inherits `WorkspaceLayoutClient` (sidebar + `WorkspaceToolbar` = the "AppToolBar"
the user means, the same chrome as `/pages`, `/chats`). Keep the page body
(`NotificationsList`) unchanged. Breadcrumb for the page = "Уведомления".

**Test:** Playwright — navigate to `/notifications`, assert the workspace toolbar
(breadcrumb / user menu) is present.

---

## 4. Personal integrations: keep only implemented (Telegram)

**Where:** `apps/web/src/app/(protected)/settings/integrations/page.tsx`,
`packages/trpc/src/routers/integration.ts`, seed
(`packages/db/prisma/seed.ts`).

**Now:** The page lists `IntegrationProvider` rows. Only **Telegram** has a real
implementation (bot, tRPC `telegram.*`, `@repo/telegram`, DB models). GitHub /
Yandex / AmoCRM / MangoOffice are placeholder cards with no OAuth/connection
logic. (The provider table may be seeded by `seed.ts`.)

**Decision (user):** Remove the unimplemented providers entirely.

**Change:** Stop the generic `IntegrationCard` list from showing unimplemented
providers. Concretely: filter `integration.listProviders` to the implemented set
(Telegram only) — and remove the unimplemented providers from `seed.ts` so fresh
DBs don't reintroduce them. The page keeps the dedicated `TelegramLinkCard`. If
the generic provider list becomes empty, render only the Telegram section (drop
the empty generic grid). Do not drop the DB tables (keep the schema for future
integrations).

**Test:** Playwright — open `/settings/integrations`, assert only Telegram is
shown and GitHub/Yandex/AmoCRM/MangoOffice are absent.

---

## 5. TLS certificate for api.anynote.ru — verify & document

**Where:** `deploy/traefik/dynamic/routers.yml`, `deploy/traefik/traefik.yml`,
`.github/workflows/deploy.yml`.

**Finding:** The `api.anynote.ru` Traefik router with `tls.certResolver: le`
(Let's Encrypt, HTTP-01) **already exists** and routes to the `engines` service.
There is no code change that issues the cert — issuance requires (a) a DNS
A-record `api.anynote.ru` → the Traefik host IP and (b) a deploy so Traefik runs
the ACME challenge. Both are outside what I can execute (no DNS/server access).

**Decision (user):** Verify the config is correct and document the exact steps.

**Change:** Re-verify the router/resolver/middlewares for `api.anynote.ru`
against the pattern used by `anynote.ru`. Add a short, accurate runbook section
to `deploy/` (e.g. `deploy/README.md` or a `docs/` note) listing: required DNS
A-record, that the router already exists, how to trigger the deploy, and how to
verify issuance (`curl -I https://api.anynote.ru`, `docker compose logs traefik |
grep acme`). No application code change.

**Test:** N/A (infra/docs). Verify YAML parses / matches the existing pattern by
inspection.

---

## 6. API key creation: "Никогда" → "Бессрочный", radios → Select

**Where:** `apps/web/src/components/settings/api-key-create-dialog.tsx:58-67`,
display text in `api-keys-section.tsx:49`.

**Now:** Expiry is a `RadioGroup` with `7d / 30d / 90d / 1y / never`; the "never"
label reads "Никогда".

**Change:** Replace the `RadioGroup` with a MUI `Select` (label "Срок действия")
holding the same five options, and rename the "never" option label to
"Бессрочный". Update the display string in `api-keys-section.tsx` from "никогда"
to "Бессрочно" (or "Без срока"). Keep the underlying `ttl` value `'never'` so the
mutation contract is unchanged.

**Test:** Playwright — open the create-API-key dialog, assert the Select shows
"Бессрочный", select it, create a key, assert it lists with the perpetual label.

---

## 7. Sidebar overhaul: unified scroll + first-level tree + drag-and-drop

**Where:** `apps/web/src/components/workspace/workspace-sidebar.tsx`,
`favorites-section.tsx`, `page-tree-section.tsx`, `types.ts`,
`page-context-menu.tsx`; tRPC `page.addFavorite/removeFavorite`,
`page.moveToCollection`, `page.archive`, `page.softDelete`.

**Now:** Favorites / Команда / Личное / Shared each have their **own** scroll
container (nested `overflow: auto`, `maxHeight: 200`). Pinned collections are not
rendered as a tree. DnD exists only for reordering *within* a section
(`@dnd-kit`). No cross-section moves, no archive/trash drop zones.

**Changes:**

a. **Single scroll.** Remove the per-section `overflow`/`maxHeight`; the whole
   pages-section area gets one scroll container so everything scrolls together.

b. **First-level tree.** Render "Избранное", "Команда", "Личное" as top-level,
   collapsible tree roots in one tree. Pinned collections render **below** these
   three roots (also as tree roots), not as separate sections above/around them.

c. **Drag-and-drop targets** (extending the existing `@dnd-kit` setup with
   `useDroppable` zones):
   - Drop a page onto **Избранное** → add favorite status only
     (`page.addFavorite`); the page is not moved out of its collection.
   - Drop a page from **Личное** onto **Команда** (or vice-versa) → fully move it
     (`page.moveToCollection { target: 'team' | 'private' }`), changing
     collection + visibility.
   - Drop onto **Архив** → `page.archive`.
   - Drop onto **Корзина** → `page.softDelete`.

   Archive/Trash are currently plain links; they become droppable while a drag is
   in progress (highlight on drag-over). Re-ordering within Команда/Личное keeps
   working (`page.reorder`); favorites reorder keeps working
   (`page.reorderFavorites`).

**Test:** Playwright — verify (1) one scroll region, (2) the three roots are
first-level tree nodes with pinned collections below, (3) drag a page into
Избранное → it gains favorite status, (4) drag personal→team → it moves
collection, (5) drag → Архив and → Корзина move the page accordingly. DnD in
Playwright uses `el.evaluate`/manual pointer events per the repo's prior DnD
test learnings.

This is the largest item; it is built and tested as its own logical unit but
ships on the same `fix/post-release-1.24` branch.

---

## 8 & 9. Move Dashboard + "Загрузить встречу" into the "+" create menu

**Where:** create menu = `apps/web/src/components/templates/create-page-dialog.tsx`
+ `page-type-registry.tsx` (`CREATABLE_PAGE_TYPES` vs
`NON_CREATABLE_PAGE_TYPE_META`). Current Dashboard/Meeting entry points =
toolbar buttons in `page-tree-section.tsx` (Dashboard → `trpc.dashboard.create`;
Meeting → `MeetingUploadDialog`).

**Now:** DASHBOARD and MEETING are explicitly excluded from the create grid and
created via separate sidebar toolbar buttons.

**Changes:**

- Add **Дашборд** and **Загрузить встречу** as entries in the create-page menu
  (the "+" flow), alongside the other page types.
- **Dashboard:** selecting it runs the existing `trpc.dashboard.create` flow
  (create page + Dashboard row, navigate to `/pages/{id}`), reusing the existing
  mutation — just triggered from the create menu.
- **Meeting:** selecting "Загрузить встречу" opens the existing
  `MeetingUploadDialog` (file upload → `meeting.create`). The create menu entry
  is the new trigger; the dialog itself is unchanged.
- Remove the now-duplicated Dashboard/Meeting buttons from the sidebar toolbar
  (or leave the sidebar "+" pointing at the unified menu) so there is one entry
  point. Plan-gating (`meetingsEnabled`) is preserved — hide/disable the Meeting
  entry when the plan flag is off, matching current behavior.

**Test:** Playwright — open the "+" create menu, assert Дашборд and "Загрузить
встречу" appear; selecting Дашборд creates a dashboard page; selecting the
meeting entry opens the upload dialog.

---

## 10. Date/time component: time selection broken

**Where:** `packages/editor/src/components/date-picker-body.tsx:38-47`,
`packages/editor/src/extensions/date.tsx`.

**Now:** For `kind === 'datetime'` the picker is `StaticDateTimePicker` with
`displayStaticWrapperAs="desktop"`. In desktop static mode the DateTimePicker
shows only the calendar and hides the time-selection UI, so the user can change
the date but not the time. (`draft` is initialized to `current` before the
popover opens, and the popover is guarded on `draft !== null`, so the older
null-race is already mitigated — the remaining cause is the display mode hiding
the time view.)

**Change:** Make the time editable in the datetime picker. Preferred fix: render
the time selection alongside the calendar — either switch the datetime branch to
a layout that exposes both the date and a time field (e.g. a `MultiSectionDigitalClock`
/ `TimeField` next to the `StaticDatePicker`, or configure the
`StaticDateTimePicker` so the time view is reachable), so a user can pick both
date and time and the chosen time persists into the ISO value. Keep the
date-only branch (`StaticDatePicker`) unchanged. Verify the saved value carries
the chosen `HH:mm`.

**Test:** Playwright — insert a "дата и время" node, change the time, save,
assert the rendered label shows the chosen time (not 00:00 / unchanged).

---

## 11. Synced block doesn't work

**Where:** `packages/editor/src/extensions/synced-block.tsx`,
`packages/editor/src/synced-block-nested-editor.tsx`,
`apps/web/src/components/page/synced-block-embed.tsx`,
`packages/trpc/src/routers/synced-block.ts`, yjs server
`canAccessSyncedBlock`.

**Now:** Cross-page live synced blocks were added in Phase 9C. The report is
"Синхронный блок не работает" — the concrete failure mode is unknown. Candidate
failure points: `getById` returning `no_access`/`deleted`/`unsynced` when it
should return `ok`; the nested `HocuspocusProvider` to `syncedBlock:{id}` failing
to connect (token/audience/access gate); the block never seeded with content; or
the renderer injection (`renderSyncedBlock`) not wired in the live editor.

**Change:** Follow systematic debugging — reproduce in the running app
(create a synced block, copy to another page, observe), capture the actual error
(network/console/yjs), identify the single root cause, then fix it and add a
regression assertion. Do not speculate-fix; reproduce first.

**Test:** Playwright (+ manual reproduction) — create a synced block, edit it,
confirm the change appears in the synced copy / the block renders editable rather
than a placeholder.

---

## 12. Page-title hover: invisible add-icon/add-cover buttons; ensure affordances

**Where:** `apps/web/src/components/page/page-header.tsx` (`ghostButtonSx`
lines 40-46; hover reveal line 161; buttons lines 188-214).

**Now:** "Добавить иконку" / "Добавить обложку" ghost buttons already exist; they
are `opacity: 0` and revealed when the title-area Stack is hovered, colored
`text.secondary`. The bug: on hover in the light theme the text is effectively
invisible. Root cause is the color/contrast of `ghostButtonSx` (and possibly the
hover background interaction), not a missing button.

**Change:** Fix the hover color so the "Add icon"/"Add cover" buttons are clearly
visible in both themes (use a theme-aware visible color, e.g. `text.secondary`
that actually contrasts, or `text.primary` on hover; ensure the reveal isn't
washed out by the title's `action.hover` background). Confirm both affordances
("Добавить иконку", "Добавить обложку") are present and functional on hover
(item 12's "add icon / add cover" sub-points).

**Test:** Playwright — hover the title, assert both buttons are visible
(non-zero opacity, contrasting color) and clicking each opens its picker. Note
the repo's E2E learning: toolbar/hover affordances may be focus-triggered; press
Escape / use the established hover technique.

---

## 13. Cover image spans full content-area width, flush under breadcrumbs

**Where:** `apps/web/src/components/page/cover-band.tsx`,
`apps/web/src/app/(protected)/(active)/pages/[pageId]/page.tsx:55-68`,
`apps/web/src/components/page/column-sx.ts` (`pageColumnSx`, `maxWidth: 809px`,
`px: 48px`), breadcrumbs in `workspace-layout-client.tsx` /
`workspace-toolbar.tsx`.

**Now:** `PageHeader` (which renders `CoverBand`) is wrapped in the
`pageColumnSx` content column (`maxWidth: 809px`, `px: 48px`, `pt: 4`), so the
cover is constrained to the reading column and sits below top padding.

**Decision (user):** Cover spans the **full width of the page area** (inside the
main scroll container, not the 809px column), flush under the breadcrumbs with no
top padding/margin.

**Change:** Render the `CoverBand` **outside** the `pageColumnSx` column so it
fills the page area's full width, with `rounded={false}` and no top padding (flush
under the toolbar/breadcrumbs). The title + add-icon/add-cover + page content stay
inside the 809px column. Structurally: in `pages/[pageId]/page.tsx`, lift the
cover out of the `PAGE_COLUMN_CLASS` box and place it first (full-bleed within the
content area), then render the column (with `pt` removed/reduced when a cover is
present) for icon/title/body. Keep the icon's Notion-style overlap with the
cover's bottom edge working in the new layout. Mobile keeps the responsive height.

**Test:** Playwright — set a cover, assert the cover element's width matches the
page content area (wider than the 809px column) and there is no gap between the
breadcrumb bar and the cover top.

---

## Cross-cutting

- **Branch:** `fix/post-release-1.24` (isolated worktree).
- **Gates:** `pnpm gates` (check-types + lint + build + test) must pass before
  merge; run full gates because shared changes (tRPC `integration`, sidebar) can
  break engines/web unit tests.
- **Playwright:** each item has a spec or an extension to an existing spec; run
  warm/isolated per the repo's cold-compile flakiness learning.
- **i18n:** UI strings are Russian, matching the existing app.
- **Out of scope:** dropping integration DB tables; deep redesign of the meeting
  pipeline; anything not in the 13 items.
