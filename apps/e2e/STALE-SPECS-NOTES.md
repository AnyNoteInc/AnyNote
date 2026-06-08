# E2E spec maintenance — neutral-URL migration (2026-06-08)

This pass updated the stale Playwright specs after the `feat/remove-workspaceid-urls`
refactor. Three classes of staleness were fixed across the suite:

## 1. Neutral URLs (DONE)
The app dropped the `/workspaces/{id}` prefix. All in-app URL literals/regexes in
specs were rewritten:
- `/workspaces/${id}/chats/${c}` → `/chats/${c}`
- `/workspaces/${id}/pages/${p}` → `/pages/${p}` (hash `#N` preserved)
- `/workspaces/${id}/settings/...` → `/settings/...`
- bare `/workspaces/${id}` → `/chats/new`
- regex `/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/` → `/\/pages\/[a-f0-9-]+/` etc.
- `/api/workspaces/${id}/pages/${p}/export/${fmt}` → `/api/pages/${p}/export/${fmt}`
- `/workspaces/new` KEPT (creation route still exists).
- `sidebar-mode.spec.ts`: `workspaceIdFromUrl()` (parsed id from URL) replaced with
  an `activeWorkspaceId(email)` DB lookup.

## 2. "Новая страница" button selector (DONE)
The fragile `getByText('Страницы').locator('xpath=ancestor::*[.//button][1]').getByRole('button')`
(and the `AddIcon`-ancestor variant) matched 5 buttons after layout changes →
strict-mode violation. Replaced with the unique `getByRole('button', { name: 'Новая страница' })`.

## 3. Page-type pick: menu → dialog (DONE)
New-page UX changed from a dropdown menu to a "Создание страницы" dialog
(`CreatePageDialog` + `PageTypeGrid`). Each type is a button with
`aria-label="Создать страницу: {label}"`. So:
- `getByRole('menuitem', { name: 'Текст' })` → `getByRole('button', { name: 'Создать страницу: Текст' })`
- same for Канбан / Генограмма / MermaidJS / PlantUML / LikeC4 / Draw.io / Холст
- the old Холст→Excalidraw and Холст→Draw.io SUBMENUS collapsed to single buttons
  (`Создать страницу: Холст` = EXCALIDRAW, `Создать страницу: Draw.io` = DRAWIO).

## 4. kanban-board UI drift (DONE — all 7 tests green)
Uncovered while validating the URL pass:
- Task creation moved from a "Создать задачу" modal to a per-column inline
  flow: `getByRole('button', { name: 'Добавить карточку' }).first()` →
  `getByPlaceholder('Введите название карточки…')` → `getByRole('button',
  { name: 'Добавить', exact: true })`. No dialog, no auto-named "Новая задача".
  The Gantt test resolves taskId from the DB by title (inline create no longer
  puts `?taskId=` in the URL).
- Settings: the kanban gear IconButton opens the dialog DIRECTLY — removed the
  stale intermediate `menuitem 'Настройки канбана'` click.
- Default priorities are Низкий/Средний/Высокий/Критичный (no "Минимальный").
- Board DnD uses @hello-pangea/dnd → `data-rbd-droppable-id` (NOT `data-rfd-`).

## OUT OF SCOPE — genuine behavior changes, NOT URL staleness (TODO, needs product decision)
These specs reach real assertions (preamble fixes work) but fail on app behavior
that evolved since they were written. They need a domain owner to decide
"intended change → update assertion" vs "regression → fix app":

- **genogram.spec.ts** (all 5 tests): genogram canvas renders a different node set.
  e.g. `Create genogram from empty state` expects 6 `.react-flow__node` (incl a
  "creation-date label node") but the app renders 5. Also the ElementMenu /
  partner / children / divorce-drag flows changed. Do NOT blindly change `6`→`5`;
  confirm whether the creation-date label node was intentionally removed.

## Known environment-only failures (not spec bugs)
- collab / excalidraw-persistence reload-persistence: no Yjs server in the
  Playwright webServer (only `next dev`). See feedback memory.
- drawio specs: load an external diagrams.net iframe (network-dependent).
- home-redesign contact form: SendSay blocks @example.com sends (`id=issueblockedpersonal`).
- seo:22 homepage canonical/OG/JSON-LD: static-meta assertion drift.
- Full-suite at 5 workers on a cold dev server times out heavy routes (run warm / fewer workers).
