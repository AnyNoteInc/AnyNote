# Sidebar & Page UX Improvements — Design

Date: 2026-06-06
Status: Approved (pending spec review)

Five independent UX changes to `apps/web` (plus one editor fix in `@repo/editor`
and two small `@repo/trpc`/`@repo/domain` additions). The changes are independent
and can be implemented and shipped in any order, but are grouped here as one
cycle because they touch overlapping files (`workspace-sidebar.tsx`).

---

## 1. Templates page ("Шаблоны")

### Goal

Add a "Шаблоны" item to the pages sidebar **above "Корзина"** that opens a page
to manage workspace templates: list, create, edit metadata, edit content, delete.

### Background

The page-templates backend already exists (merged `feat/page-templates`):

- Prisma model `PageTemplate` (`packages/db/prisma/schema.prisma:423-451`):
  `id, workspaceId, scope, key, title, description, icon, category, type,
  content (Json), contentYjs (Bytes), usageCount, createdById, updatedById,
  timestamps, deletedAt`.
- tRPC router `packages/trpc/src/routers/template.ts`:
  `search, listByWorkspace, listGlobal, createFromPage, createPageFromTemplate,
  update, delete`.
- Domain service `packages/domain/src/templates/services/templates.service.ts`
  with matching methods; permission helper `canCreateWorkspaceTemplate`
  (OWNER/ADMIN/EDITOR or page creator).
- UI components under `apps/web/src/components/templates/` are used **inline**
  in the create-page flow only. There is **no dedicated templates route** yet.

### Decisions (from brainstorming)

- Templates page = **list + full editor** (edit content as a real page-like editor).
- Editor = **single-user editor with explicit save**, NOT Hocuspocus/Yjs.
  Templates are rarely co-edited; real-time is unnecessary and avoids touching
  `apps/yjs`.

### Design

**Route:** new `apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/`

- `page.tsx` (server) — loads `template.listByWorkspace({ workspaceId })` via
  `getServerTRPC`, renders `TemplatesPage` client component with the list.
- `[templateId]/page.tsx` (server) — loads the single template
  (new `template.getById`), renders `TemplateEditor`.

**Sidebar item:** in `workspace-sidebar.tsx`, inside the `pages` section, add a
`NavItem` for "Шаблоны" in the same `<Stack>` as "Корзина", **placed above** the
Корзина `NavItem`. Icon: **`DashboardCustomizeIcon`** (add
`export { default as DashboardCustomizeIcon } from '@mui/icons-material/DashboardCustomize'`
to `packages/ui/src/components/index.ts` if not present). href:
`/workspaces/{id}/templates`.

**Components (new, under `apps/web/src/components/templates/`):**

- `templates-page.tsx` — list view. Renders template cards/rows (icon, title,
  description, category, usageCount) + "Создать шаблон" button. Per-item actions:
  open editor, edit metadata (modal), delete (confirm).
- `template-list-item.tsx` — one row/card with actions menu.
- `template-editor.tsx` — single-user Tiptap editor seeded from `template.content`
  (or `contentYjs` decoded to a doc), local edits, "Сохранить" button → calls
  `template.updateContent`. Reuses the existing Tiptap editor configuration from
  `@repo/editor` but **without** the Hocuspocus collaboration provider.
- `template-metadata-dialog.tsx` — create/edit metadata form (title, icon,
  description, category). Reuses existing `save-as-template-dialog.tsx` form fields
  where practical.

**New tRPC procedures (`packages/trpc/src/routers/template.ts`) + domain methods:**

- `template.create` — create an empty workspace template (title required, type
  defaults to TEXT, empty content). Returns `{ id }`. Permission: same as
  `canCreateWorkspaceTemplate`. Domain: `templatesService.create(...)`.
- `template.getById` — fetch a single template (metadata + content) for the
  editor. Scoped to workspace + access check.
- `template.updateContent` — persist edited content. Input: `templateId,
  workspaceId, content (Json), contentYjs (Bytes)`. Writes both columns to keep
  parity with pages. Domain: `templatesService.updateContent(...)`.

`update` (metadata) and `delete` (soft-delete) already exist and are reused.

**Content serialization:** the single-user editor produces a ProseMirror/JSON
doc. To stay compatible with how templates are consumed (`createPageFromTemplate`
copies `content` + `contentYjs` into a new page), `updateContent` writes both:
the JSON snapshot (`content`) and a serialized Yjs update (`contentYjs`) produced
from the editor doc. The editor uses a local `Y.Doc` (no network provider) so a
`contentYjs` byte payload is available on save.

### Components / isolation

`templates-page.tsx` (list) depends on tRPC queries only. `template-editor.tsx`
is self-contained: takes a template id + initial content, owns its local Y.Doc,
emits saves via tRPC. Metadata dialog is a controlled form. Each unit is testable
in isolation.

---

## 2. Page navigation (table of contents) — always-mini + hover popover

### Goal

On TEXT pages, the outline widget currently has three modes (off / mini / full)
toggled from the page actions menu. Change to: **always show mini**, remove all
toggles, and on **hover over mini** show the full navigation in a popover
(clickable, with a close delay — Notion-style hover bridge).

### Current state

- `apps/web/src/components/page/editor-outline.tsx` — renders mini (right-side
  bars, ~L194-286) or full (indented list, ~L288-397) based on a `mode` prop;
  `extractHeadings` collects h1/h2/h3; `activeHeading` tracked by scroll.
- `apps/web/src/hooks/use-outline-mode.ts` — `OutlineMode = 'off'|'mini'|'full'`,
  default `'mini'`, persisted via `usePagePref` (key `page-outline-mode`).
- `apps/web/src/components/page/page-actions-menu.tsx` (~L190-245) — the
  three-button ButtonGroup toggle (VisibilityOff / Dehaze / Toc).
- `page-renderer.tsx` reads the mode and passes it to `<EditorOutline>`.
- `workspace-layout-client.tsx` sets `data-outline-mode` from the mode.

### Design

- **`page-actions-menu.tsx`**: remove the entire outline-mode ButtonGroup block
  (and now-unused imports: `VisibilityOffIcon`, `DehazeIcon`, `TocIcon`, and
  `ButtonGroup` if unused elsewhere in the file).
- **`use-outline-mode.ts`**: **delete** the hook and its `OutlineMode` type. The
  `page-outline-mode` pref key is no longer used. (`usePagePref` itself stays —
  used by other prefs.)
- **`page-renderer.tsx`**: stop reading/passing `mode`; render
  `<EditorOutline editor={editor} rightOffset={...} />` unconditionally for TEXT
  pages.
- **`workspace-layout-client.tsx`**: remove the `data-outline-mode` wiring (and
  the `useOutlineMode` import). If any CSS keys off `data-outline-mode`, replace
  with a static behavior (mini is always present).
- **`editor-outline.tsx`** (main change):
  - Drop the `mode` prop. Always render the mini bars.
  - Extract the full list rendering into a sub-component `OutlineFullPanel`
    (the current full-mode JSX).
  - Wrap the mini bars in a hover trigger: `onMouseEnter` opens a `Popover`
    (or `Popper`) anchored to the mini container showing `OutlineFullPanel`;
    `onMouseLeave` closes after a ~150ms delay. The delay is cancelled if the
    pointer enters the panel itself (hover bridge) — implement with a shared
    timeout ref cleared on the panel's `onMouseEnter`.
    - Open/close behaviour: hover opens; clicking a heading scrolls to it (reuse
      existing click handler) and the panel may stay until mouse leaves.
  - `activeHeading` highlighting applies to both the mini bars and the panel.
  - If there are no headings, render nothing (unchanged).

### Components / isolation

`OutlineFullPanel` is a pure presentational unit (headings + active id + click
handler). The hover-intent logic (open/close-with-delay) is small and local to
`editor-outline.tsx`. No persisted state remains.

---

## 3. DateTime node — time cannot be edited (bug)

### Goal

In the editor's `date` node, when `kind === 'datetime'` the user can change the
date but **not the time**. Fix it.

### Root cause

`packages/editor/src/extensions/date.tsx`:

- `draft` is initialized to `null` (L18).
- On click, `setDraft(current)` (L27) is asynchronous, but the `Popover` (and the
  `StaticDateTimePicker` inside it) render in the same cycle with `value={null}`.
- `StaticDateTimePicker` mounted with `null` does not properly initialize its
  time controls and doesn't re-sync when `draft` becomes a `Date`. The date grid
  recomputes from clicks (so date appears editable), but the time controls stay
  frozen. `StaticDatePicker` (kind=date) has no time controls, so the bug is
  invisible there.

### Design (minimal, targeted)

`packages/editor/src/extensions/date.tsx`:

- Only open the Popover once `draft` is set:
  `open={Boolean(anchor) && draft !== null}`. This guarantees the picker mounts
  with a real `Date`, never `null`, eliminating the first-render race.

`packages/editor/src/components/date-picker-body.tsx`:

- Add a `key` to the picker tied to `mode` (and the presence of a value) so MUI
  re-mounts the picker cleanly on init / mode change — a safety net against MUI's
  internal desync. e.g. `key={mode}` on the conditional picker.

### Verification

Reproducible only in the real editor (MUI picker unit tests are unreliable).
Manual browser check: insert a datetime node → open → change both date and time →
save → reopen → value persisted correctly. Also re-check the plain `date` node
still works, and the slash-insert popover (`DateInsertPopover`) which shares
`DatePickerBody`.

---

## 4. Main sidebar — section icons & active/inactive button shape

### Goal

In `WorkspaceSectionSwitcher` (`workspace-sidebar.tsx:248-311`):

- Remove the **Settings** section button (moves to the space menu, §5).
- New icons + labels: 🏠 `HomeIcon` "Домашняя" (pages), 💬 `ChatBubbleOutlineIcon`
  "Чаты", 🔍 `SearchIcon` "Поиск".
- Inactive buttons = icon-only ("tag"). Active button = **pill** (icon + label).
- Search is **never active** — always an icon-only button that opens the search
  dialog (⌘K).

### Current state

`WorkspaceSectionSwitcher` is a `ButtonGroup` of 4 equal icon-only buttons
(Search, Chats, Pages, Settings). Active state via inline `activeButtonStyle`
(`backgroundColor: rgba(201,100,66,0.14); color: #c96442`).

### Design

- Replace `ButtonGroup` with a horizontal `Stack direction="row"`.
- Internal helper `SectionButton({ active, icon, label, ... })`:
  - `active` → wide pill `Button` with `flex: 1`, `startIcon`, visible label,
    accent background/color (reuse current `activeButtonStyle`).
  - inactive → compact icon-only `Button`/`IconButton` with `aria-label` +
    `Tooltip` (keeps shortcut hint).
- Buttons:
  - **Домашняя** (pages): `HomeIcon`, active when `activeSection === 'pages'`,
    `onClick={onPages}`, `aria-pressed`.
  - **Чаты** (if `chatsEnabled`): `ChatBubbleOutlineIcon`, active when
    `activeSection === 'chats'`, `onClick={onChats}`, `aria-pressed`.
  - **Поиск**: `SearchIcon`, always icon-only, `onClick={onSearch}` (opens dialog).
- Remove the Settings button entirely; remove `onSettings` from
  `WorkspaceSectionSwitcher` props. (`activeSection === 'settings'` is no longer
  reachable from here — settings open as a modal in §5, and the settings sidebar
  section is removed entirely per §5.)
- **`HomeIcon` is not currently exported from `@repo/ui/components`** — add
  `export { default as HomeIcon } from '@mui/icons-material/Home'` to
  `packages/ui/src/components/index.ts`.

### Accessibility

Icon-only buttons keep `aria-label` + `Tooltip`. The active pill has a visible
label. `aria-pressed` retained for Домашняя/Чаты.

---

## 5. Space menu + full-screen settings modal

### Goal

Clicking the space header **always** opens a menu. The menu shows: the current
space name; for **owners**, "Настройки" and "Пригласить участников" on a second
row; then a list of spaces to switch to. Settings open as a **full-screen modal**
(left = section nav, right = content). The standalone Settings/Invite buttons
(screenshot reference) consolidate into this menu. The Settings **section in the
sidebar is removed**.

### Current state

- `workspace-sidebar.tsx`: header click opens a switcher `Menu` **only when
  `hasMultiple`** (L92, L137-174). `trpc.workspace.listMine` lists spaces.
- Owner detection: `trpc.workspace.getMyRole({ workspaceId })` → `'OWNER'`.
- Settings currently live as: sidebar section (`activeSection === 'settings'` →
  `<WorkspaceSettingsNav>`, L228) + pages under
  `/workspaces/[id]/settings/{general,members,ai,mcp,files,usage,danger}` whose
  server `page.tsx` feed section components props (workspace, myRole, plan,
  currentUserId, features).
- Settings sections: `general-section`, `members-section`, `ai-section`,
  `mcp-section`, `files-section`, `usage-section`, + a danger section.
- `WorkspaceSettingsNav` items: Общее, Участники, AI агент, MCP серверы,
  Библиотека, Использование, Опасная зона (gated by plan features).

### Decisions (from brainstorming)

- Menu layout: **space name on line 1; "Настройки" + "Пригласить участников" on
  line 2** (owner-only); space-switch list below.
- Settings = **full-screen modal** reusing existing section components.
- Sidebar `settings` section is **removed**; `/settings/*` page UIs are replaced
  by the modal.

### Design

**Space menu (`workspace-sidebar.tsx`):**

- Header click **always** opens the menu (remove the `hasMultiple` guard on
  `onClick`/`cursor`/hover/arrow).
- Fetch `getMyRole`; `isOwner = role === 'OWNER'`.
- Menu content (use a `Menu` with custom non-MenuItem header rows or a `Popover`
  for layout freedom):
  - **Line 1:** current space avatar + name (header, non-clickable).
  - **Line 2 (owner only):** two small buttons — ⚙️ "Настройки" and 👤
    "Пригласить участников".
    - "Настройки" → open `WorkspaceSettingsDialog` on the "general" section.
    - "Пригласить участников" → open `WorkspaceSettingsDialog` on the "members"
      section.
  - `Divider`.
  - **Space list:** all spaces from `listMine` (current marked selected, link to
    `/workspaces/{id}`). Shown even with one space.
  - Optional: "＋ Создать пространство" → `/workspaces/new`. (Include unless told
    otherwise — low cost, fits here.)
- Non-owner: menu shows only the name header + space list (no settings/invite row).

**Full-screen settings modal (`WorkspaceSettingsDialog`, new client component):**

- MUI `Dialog` `fullScreen`, two-pane layout:
  - Left: section nav (the `WorkspaceSettingsNav` item list, adapted to drive
    internal state instead of routing). Items gated by plan features
    (`usePlanFeatures`).
  - Right: the active section component.
  - Top bar with title + close (×) button.
- Internal `activeSection` state (string slug), not URL. Opening via ⚙️ → 'general';
  via 👤 → 'members'.
- **Data loading:** the existing section components were fed by server `page.tsx`
  props. In the modal (client) each section must fetch its own data via client
  tRPC (`trpc.workspace.getById`, `getMyRole`, `subscription.getCurrent`, etc.)
  or accept already-available props (the dialog can fetch shared data once —
  workspace, myRole, plan, currentUserId — and pass down). Plan: dialog fetches
  the shared bits once (`getById`, `getMyRole`, `subscription.getCurrent`, session
  user id) and passes them to sections, mirroring the current page props. Section
  components themselves stay unchanged in their prop contracts where possible; if
  a section currently relies on a server-only fetch, add a thin client wrapper.

**Removals:**

- Sidebar `settings` section: the `activeSection === 'settings'` render (L228) and
  any switch-to-settings affordance.
- `/workspaces/[id]/settings/*` page UIs: replaced by the modal. **Default
  (chosen):** delete the per-section `page.tsx` UIs, and replace
  `/workspaces/[id]/settings/page.tsx` (and any `[...]` settings index) with a
  `redirect()` to the workspace root so old links don't 404. The section
  *components* (`general-section`, `members-section`, etc.) are retained and reused
  by the modal.
- `onSettings` prop from `WorkspaceSectionSwitcher` (§4).

### Accessibility / edge cases

- `getMyRole` is async; owner-only row hidden until it resolves as 'OWNER'.
- Modal: focus trap (MUI Dialog default), Escape to close, labelled close button.
- Single-space non-owner: menu still opens, shows the one space.

---

## Cross-cutting

- **Env vars:** none added.
- **Prisma migrations:** none — `PageTemplate` already exists; §1 only adds tRPC
  procedures over existing columns.
- **transpilePackages:** no new web-consumed packages.
- **Gates:** `pnpm gates` (check-types + lint + build + test). Shared-model
  reminder: §1's tRPC additions are pure additions; confirm engines/agents are
  unaffected (templates aren't consumed there). §5 removes routes — run
  `rm -rf apps/web/.next/types` if stale route-type errors appear.
- **Testing:**
  - §1: tRPC tests for `create` / `getById` / `updateContent` (permission +
    passthrough). Web component test for the templates list.
  - §2: component test of `editor-outline` hover open/close and heading click
    (hover-intent timing may need fake timers); verify in real app.
  - §3: manual browser verification (insert datetime, edit time, persist).
  - §4: component test of `WorkspaceSectionSwitcher` active pill vs inactive icon.
  - §5: component test of space menu (owner vs non-owner) and modal section
    switching; verify removed routes don't break navigation.

## Out of scope (YAGNI)

- Real-time/collaborative template editing (Hocuspocus for templates).
- Global template gallery / `listGlobal` UI.
- Template categories management UI beyond a free-text field.
- Deep-linkable settings URLs (modal uses internal state, not routes).
