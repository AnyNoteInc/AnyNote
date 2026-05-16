# Kanban sprint management (table view)

**Date**: 2026-05-16
**Scope**: `apps/web/src/components/kanban/**`, `packages/trpc/src/routers/kanban/sprint.ts`
**Affects**: kanban table view only — board and gantt views unchanged

## Problem

The table view (`view=table`) renders sprints as static, drag-target groups with no lifecycle controls: a user cannot start, complete, edit, or delete a sprint from the UI. Sprint status displays as the raw enum literal (`PLANNED`, `ACTIVE`, `COMPLETED`) instead of a translated label, and the section header omits sprint dates. There is no visual signal for the active sprint, and the default sprint filter is always `all` even when an active sprint exists.

The backend already exposes `sprint.activate`, `sprint.update`, `sprint.complete`, and `sprint.delete` mutations and the schema enforces single-ACTIVE-sprint semantics. What is missing is (a) a UI surface to invoke those mutations and (b) two minor backend extensions to support a richer "complete sprint" flow.

## Goals

1. Per-sprint three-dot context menu in the table view with **Стартовать**, **Завершить**, **Изменить**, **Удалить** actions, gated by current sprint status.
2. Translated status badge (`Планирование` / `Активный` / `Завершён`), inline sprint dates after the name, and a left-border accent for the ACTIVE sprint.
3. "Завершить спринт" modal showing done/undone counts (done = task's column kind is `DONE` or `CANCELLED`) and letting the user redirect undone tasks to another sprint or the backlog. Done tasks remain attached to the completed sprint as history.
4. "Изменить спринт" modal for name, description, start/end date — clone of the existing create dialog.
5. "Удалить спринт" confirm dialog showing how many tasks will return to the backlog.
6. On first visit to a kanban page (no `sprint=...` URL param) with an ACTIVE sprint present, the sprint filter behaves as `current` without writing to the URL. Explicit URL choices always win.

## Non-goals

- No changes to board view (`view=board`) or gantt view.
- No changes to sprint create flow beyond extracting a shared `SprintFormFields` component.
- No new "active sprint" boolean field — single ACTIVE is already enforced by status.
- No i18n framework introduction — strings stay hardcoded Russian, matching the rest of the kanban folder.
- No localStorage-backed filter persistence — the URL remains the only source of truth.

## Architecture

### Data model (no changes)

- `Sprint.status: SprintStatus` enum (`PLANNED | ACTIVE | COMPLETED`) — already the single source of truth for "current sprint".
- `Task.sprintId` is nullable; `onDelete: SetNull` on the relation already detaches tasks to the backlog when their sprint is deleted (`packages/db/prisma/schema.prisma:994`).

### Backend (`packages/trpc/src/routers/kanban/sprint.ts`)

Two procedures gain inputs; nothing renames or breaks signature compatibility for the create/update/activate paths.

#### `sprint.complete` — input change

Current:
```ts
{ pageId: uuid, id: uuid } → { ok: true }
```

New:
```ts
{ pageId: uuid, id: uuid, moveUndoneTo: uuid | null } → { ok: true }
```

Behavior, in one transaction:
1. Resolve the sprint and assert `pageId` match.
2. If `moveUndoneTo` is non-null, assert it points to a sprint on the same `pageId` and is not `id`.
3. Load the page's columns. Undone column ids = columns where `kind === 'ACTIVE'` (the schema has exactly three kinds: ACTIVE, DONE, CANCELLED).
4. `updateMany` on `Task` where `sprintId = id AND columnId IN (undoneColumnIds)`: set `sprintId = moveUndoneTo`, clear `sprintPosition` so the destination sprint orders the new arrivals by its own position rules.
5. Set `Sprint.status = 'COMPLETED'` for `id`.
6. Emit `kanbanBus.emit('sprint.upserted', { pageId, sprintId: id })`. If `moveUndoneTo` is non-null, emit a second `sprint.upserted` for that sprint id.

Tasks in `DONE` or `CANCELLED` columns stay attached to the completed sprint. No `SPRINT_CHANGED` activity rows are written for the bulk move — `updateMany` does not invoke the per-task activity logging path, and adding bulk-activity writes is out of scope (see Risks).

#### `sprint.delete` — unchanged

No input change. The existing `onDelete: SetNull` cascade detaches tasks to backlog. The "how many tasks?" count shown in the confirm dialog is derived client-side from the already-loaded board.

#### `sprint.activate` and `sprint.update` — unchanged

`activate` already demotes any other ACTIVE sprint to PLANNED in a transaction. `update` already covers name, description, startDate, endDate.

#### Tests (`packages/trpc/test/`)

New cases for `sprint.complete`:
- Moves only undone tasks (DONE/CANCELLED tasks stay attached).
- Rejects `moveUndoneTo` pointing to a sprint on a different page (`NOT_FOUND` / `BAD_REQUEST`).
- Rejects `moveUndoneTo === id` (`BAD_REQUEST`).
- Accepts `moveUndoneTo: null` (tasks become backlog).
- Sets status to `COMPLETED`.

### Frontend

#### File map

```
apps/web/src/components/kanban/
├── sprint/
│   ├── sprint-create-dialog.tsx          (existing — refactored to use SprintFormFields)
│   ├── sprint-edit-dialog.tsx            (NEW)
│   ├── sprint-complete-dialog.tsx        (NEW)
│   ├── sprint-delete-dialog.tsx          (NEW)
│   ├── sprint-form-fields.tsx            (NEW — extracted shared form body)
│   ├── sprint-menu.tsx                   (NEW — three-dot menu)
│   └── sprint-status-label.ts            (NEW — pure helper)
├── views/
│   └── sprint-section.tsx                (modified — new header layout, accent, menu slot)
├── use-kanban-filters.ts                 (modified — defaultSprint argument)
└── kanban-board-page.tsx                 (modified — passes defaultSprint based on board.sprints)
```

#### Sprint section header (`views/sprint-section.tsx`)

Current header is `title` + `subtitle` strings. New layout, single row, left to right:

```
┌────────────────────────────────────────────────────────────────────┐
│ Спринт 1   15 мая — 29 мая   [Активный]              5 задач   ⋮  │
└────────────────────────────────────────────────────────────────────┘
```

Props shape changes from `{ title, subtitle?, ... }` to:

```ts
type SprintSectionProps =
  | { kind: 'sprint'; sprint: BoardSprint; pageId: string; tasks: BoardTaskData[]; allSprints: BoardSprint[]; allColumns: BoardColumn[]; allTasks: BoardTaskData[]; members: BoardMember[] }
  | { kind: 'backlog'; tasks: BoardTaskData[]; members: BoardMember[] }
```

A `kind` discriminator avoids forking the component while keeping the backlog path free of menu/status concerns. The component renders:

- **Name** (`<Typography variant="subtitle1" fontWeight={600}>`)
- **Dates span** (only for `kind: 'sprint'`, only when at least one date is set) using `date-fns/format` with the existing `dateFnsRu` adapter:
  - both: `dd MMM — dd MMM`, append `yyyy` to end date when its year ≠ current year
  - only start: `с dd MMM`
  - only end: `до dd MMM`
- **Status badge** (`<Chip size="small">`) with label from `sprintStatusLabel(status)`:
  - PLANNED → `Планирование`, color `default`
  - ACTIVE → `Активный`, color `primary`
  - COMPLETED → `Завершён`, color `success`
- **Task count** (unchanged, right-aligned)
- **`<SprintMenu>` slot** (right of the count, only for `kind: 'sprint'`)

When `sprint.status === 'ACTIVE'`, the section's outer `<Paper>` gets `borderLeft: '3px solid'` with `borderLeftColor: 'primary.main'`, and the header band gets `bgcolor: 'primary.50'`. Backlog never gets the accent.

The `<Droppable>` body and drag-target logic are unchanged.

#### Sprint context menu (`sprint/sprint-menu.tsx`)

Component shape matches `ColumnMenu` (`views/board-column.tsx:84-140`): a `useState<HTMLElement | null>` anchor, an `IconButton` with `MoreVertIcon`, a `Menu` with `ListSubheader` and `MenuItem`s.

```tsx
interface SprintMenuProps {
  readonly pageId: string
  readonly sprint: BoardSprint
  readonly otherSprints: BoardSprint[]   // for the destination picker
  readonly columns: BoardColumn[]        // for done/undone classification
  readonly tasks: BoardTaskData[]        // tasks of *this* sprint
}
```

Menu items, with visibility rules and icons:

| Item              | Icon         | Visible when           | Action                                    |
|-------------------|--------------|------------------------|-------------------------------------------|
| Стартовать спринт | PlayArrow    | status === 'PLANNED'   | `sprint.activate.mutate({pageId,id})`     |
| Завершить спринт  | Flag         | status === 'ACTIVE'    | open SprintCompleteDialog                  |
| Изменить спринт   | Edit         | always                 | open SprintEditDialog                      |
| (divider)         |              |                        |                                            |
| Удалить спринт    | Delete (red) | always                 | open SprintDeleteDialog                    |

The menu component owns dialog open state via a single discriminator:

```ts
const [dialog, setDialog] = useState<'edit' | 'complete' | 'delete' | null>(null)
```

This keeps `SprintSection` free of dialog plumbing. Each dialog invalidates `trpc.kanban.board.getBoard` on success.

Loading state: a mutation in flight disables the same menu item (`mutation.isPending`). Errors surface as dialog-local inline error text rendered below the action buttons — same pattern as the existing sprint create dialog. No toast layer is introduced.

#### Sprint edit dialog (`sprint/sprint-edit-dialog.tsx`)

Direct clone of `sprint-create-dialog.tsx` structure (Dialog → DialogTitle → DialogContent Stack → DialogActions). Pre-fills from the passed-in sprint. Title: `Изменить спринт`. Submit button: `Сохранить`, disabled when name is empty OR when the current form values are field-by-field equal to the originals (compare name, description, `startDate?.getTime()`, `endDate?.getTime()`). Calls `sprint.update.mutate({ pageId, id, name, description, startDate, endDate })`.

To prevent drift between create and edit dialogs, the four form fields (name TextField, description multiline TextField, start DatePicker, end DatePicker with `minDate=startDate`) are extracted into `sprint-form-fields.tsx`:

```tsx
interface SprintFormFieldsProps {
  values: { name: string; description: string; startDate: Date | null; endDate: Date | null }
  onChange: (next: SprintFormFieldsProps['values']) => void
  autoFocusName?: boolean
}
```

`sprint-create-dialog.tsx` is refactored to consume `SprintFormFields`; its public props are unchanged.

#### Sprint complete dialog (`sprint/sprint-complete-dialog.tsx`)

```
┌─ Завершить спринт «Спринт 1» ─────────────┐
│                                            │
│  Выполнено      Не выполнено              │
│      8                3                    │
│                                            │
│  Куда перенести невыполненные задачи?     │
│  [ Выбрать спринт ▾ ]                     │
│    • Спринт 2 (планирование)              │
│    • Спринт 3 (планирование)              │
│    • Беклог                                │
│                                            │
│              [Отмена]  [Завершить]        │
└────────────────────────────────────────────┘
```

Counts derived client-side from the props (already-loaded board data):

```ts
const undoneColumnIds = new Set(columns.filter(c => c.kind === 'ACTIVE').map(c => c.id))
const sprintTasks = tasks.filter(t => t.sprintId === sprint.id)
const undone = sprintTasks.filter(t => undoneColumnIds.has(t.columnId))
const done = sprintTasks.length - undone.length
```

Destination picker: MUI `<Select>` listing all PLANNED sprints on this page (sorted by `position`) plus a `Беклог` option (value `null`). Default selection: first planned sprint by position if any exists; otherwise backlog. When `undone.length === 0`, the picker section collapses out (no need to choose a destination — but the mutation still receives `null`).

Submit: `sprint.complete.mutate({ pageId, id, moveUndoneTo })`. Loading state disables both buttons. Success → close dialog and invalidate `getBoard`.

#### Sprint delete dialog (`sprint/sprint-delete-dialog.tsx`)

```
┌─ Удалить спринт «Спринт 1»? ──────────────┐
│                                            │
│  11 задач(и) вернутся в беклог.            │
│  Это действие нельзя отменить.             │
│                                            │
│              [Отмена]  [Удалить]          │
└────────────────────────────────────────────┘
```

Task count derived from the same loaded board data. A small co-located helper handles Russian pluralization:

```ts
function pluralizeRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}
// pluralizeRu(11, ['задача', 'задачи', 'задач']) → 'задач'
```

Submit: `sprint.delete.mutate({ pageId, id })`. "Удалить" button: `color="error"`, `variant="contained"`, disabled while pending. Success → close dialog and invalidate `getBoard`.

#### Filter default-to-current (`use-kanban-filters.ts`)

Add an optional argument:

```ts
interface UseKanbanFiltersOptions { defaultSprint?: 'current' | 'all' }
export function useKanbanFilters(options: UseKanbanFiltersOptions = {})
```

Inside the existing `useMemo` for `filters` (use-kanban-filters.ts:27-43), change the no-param branch:

```ts
// before:
let sprint: KanbanFilters['sprint'] = 'all'
if (sprintParam === 'current') sprint = 'current'
else if (sprintParam && sprintParam !== 'all') sprint = parseCsv(sprintParam)

// after:
let sprint: KanbanFilters['sprint'] = options.defaultSprint ?? 'all'
if (sprintParam === 'current') sprint = 'current'
else if (sprintParam === 'all') sprint = 'all'
else if (sprintParam) sprint = parseCsv(sprintParam)
```

Explicit URLs (`?sprint=all`, `?sprint=current`, `?sprint=<csv>`) always win.

Caller (`kanban-board-page.tsx`):

```ts
const hasActive = board.sprints.some((s) => s.status === 'ACTIVE')
const filtersBag = useKanbanFilters({ defaultSprint: hasActive ? 'current' : 'all' })
```

No URL writes from the default — the default is purely a derivation. No SSR risk: the hook is `'use client'`.

### Data flow examples

**Завершить спринт with undone redirect**

1. User clicks `⋮` on ACTIVE Sprint 1 → `Завершить спринт`.
2. `SprintCompleteDialog` mounts; reads `tasks` and `columns` from props; computes `done=8, undone=3`.
3. User picks "Спринт 2" in the destination picker.
4. Submit calls `sprint.complete.mutate({ pageId, id: sprint1.id, moveUndoneTo: sprint2.id })`.
5. Backend transaction: undone tasks become `sprintId = sprint2.id`, Sprint 1 becomes `COMPLETED`.
6. `sprint.upserted` events for sprint1 and sprint2 trigger the existing SSE listeners in the client; `getBoard` invalidates; UI re-renders with the new section memberships and a `Завершён` badge on Sprint 1.

**Удалить спринт**

1. User clicks `⋮` on Sprint 3 → `Удалить спринт`.
2. `SprintDeleteDialog` shows "11 задач вернутся в беклог".
3. Submit calls `sprint.delete.mutate({ pageId, id })`.
4. Backend deletes the sprint row; Postgres `SET NULL` cascade clears `Task.sprintId` for the 11 tasks.
5. `sprint.deleted` event invalidates `getBoard`; UI re-renders with those 11 tasks in the Беклог section.

**Стартовать спринт**

1. User clicks `⋮` on PLANNED Sprint 2 (Sprint 1 is currently ACTIVE) → `Стартовать спринт`.
2. `sprint.activate.mutate({ pageId, id: sprint2.id })` fires (no dialog).
3. Backend transaction: Sprint 1 → PLANNED, Sprint 2 → ACTIVE.
4. Two `sprint.upserted` events invalidate `getBoard`; UI re-renders: Sprint 2 gets the primary border + `Активный` badge; Sprint 1 loses both. Filter stays whatever the URL says (or defaults to `current` on fresh visit).

### Error handling

- Backend mutations propagate TRPC errors; dialogs render inline error text below the action buttons on failure (no toast layer assumed). Form remains open on error so the user can retry or cancel.
- Backend validations guard the obvious cross-page tampering and self-redirect attempts in `sprint.complete`.
- Frontend treats missing/empty board data defensively: if `tasks` is empty, counts are zero and the picker still works (defaults to backlog).

### Testing

**Backend (`packages/trpc/test/`)**
- `sprint.complete`: undone tasks move, DONE/CANCELLED tasks stay, status flips.
- `sprint.complete`: invalid `moveUndoneTo` (cross-page) rejected.
- `sprint.complete`: `moveUndoneTo === id` rejected.
- `sprint.complete` with `moveUndoneTo: null` → tasks become backlog.

**E2E (`apps/e2e/`)** — one spec exercising the four lifecycle paths:
1. Create two PLANNED sprints with tasks; activate sprint A; verify border + badge + filter default.
2. Edit sprint A's name; verify header updates.
3. Complete sprint A with redirect to sprint B; verify task relocation, status change, dialog counts.
4. Delete sprint B; verify confirm dialog count, verify tasks land in Беклог.

**Unit / component (`apps/web/test/`)** — light coverage:
- `pluralizeRu` boundary cases (1, 2, 5, 11, 21, 22, 25, 0).
- `sprintStatusLabel` returns the expected three labels.

## Risks and mitigations

- **`sprint.complete` activity logging gap**: bulk `updateMany` does not write `SPRINT_CHANGED` activity rows (the activity write lives in `task.update`). For the initial implementation we accept this gap — it matches how no other bulk-move operations write activities. Mitigation: revisit if the activity log becomes load-bearing for sprint workflows; an explicit `taskActivity.createMany` call inside the same transaction would be the fix.
- **Filter default flickers on first paint**: the `useMemo` recomputes once `board` finishes loading. Mitigation: `kanban-board-page.tsx` already suspends rendering of view components until `board` is available, so there is no observable flicker for the table view; if a flicker appears under slow networks, gate `useKanbanFilters` until `board` is loaded.
- **Dialog data freshness**: counts in `SprintCompleteDialog` / `SprintDeleteDialog` read from the cached `getBoard` data, which can be slightly stale. Mitigation: the same data drives the UI the user just clicked from; a stale-by-seconds count is acceptable for a confirm summary. The backend is the source of truth for the actual operation.

## Open questions resolved during brainstorming

- "Done" = `column.kind ∈ {DONE, CANCELLED}` (not just DONE).
- Default-to-current applies only when URL has no `sprint` param.
- Status labels: Планирование / Активный / Завершён.
- Delete requires confirm with task count.
- Done tasks remain attached to completed sprint (historical record).
- Date display omits if both dates absent; no placeholder text.
