# Parent Task Hierarchy Visual Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make parent tasks (tasks that have at least one child) visually obvious across the Kanban board, table, and Gantt views, and add a "Подзадачи" (subtasks) block with a progress bar inside the task detail view.

**Architecture:** All hierarchy data is derived client-side from the flat `kanban.board.getBoard` task list — no backend, Prisma, or tRPC changes. A new pure helper module (`hierarchy.ts`) computes the parent→children map and subtask progress. A shared `ParentBadge` presentational component is reused by the board card and table row. A new `SubtasksSection` component renders the subtask list + progress bar in the detail view. The Gantt view gets a saturated color palette for parent bars.

**Tech Stack:** TypeScript, React 19, Next.js App Router, MUI v6 (via `@repo/ui/components`), `@hello-pangea/dnd`, `gantt-task-react`, Vitest (node env, tests in `apps/web/test/`).

**Definitions:**
- A task is a **parent** iff at least one other task has `parentId === task.id` (i.e. `children.length > 0`). Top-level tasks without children are NOT highlighted.
- "Done" for progress = the task's column has `kind === 'DONE'`. `CANCELLED` children count toward the denominator (total) but not the numerator (done).

**Conventions verified in this codebase:**
- Web tests live in `apps/web/test/kanban/*.test.ts` (NOT colocated). Vitest `include` is `test/**/*.test.{ts,tsx}`. Import source via the `@/` alias.
- Import MUI only through `@repo/ui/components`. `AccountTreeIcon`, `LinearProgress`, `Tooltip` are already re-exported there.
- Prettier: no semicolons, single quotes, trailing commas, 100-char width.
- Types: `BoardTaskData`, `BoardColumnRow`, `BoardData` are in `apps/web/src/components/kanban/types.ts`.

---

## Task 1: `hierarchy.ts` pure helper + tests

**Files:**
- Create: `apps/web/src/components/kanban/lib/hierarchy.ts`
- Test: `apps/web/test/kanban/hierarchy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/kanban/hierarchy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

import {
  buildChildrenMap,
  getChildren,
  subtaskProgress,
} from '@/components/kanban/lib/hierarchy'
import type { BoardColumnRow, BoardTaskData } from '@/components/kanban/types'

function task(id: string, parentId: string | null, columnId: string): BoardTaskData {
  return {
    id,
    pageId: 'p1',
    columnId,
    typeId: null,
    priorityId: null,
    sprintId: null,
    parentId,
    title: id,
    description: null,
    startDate: null,
    dueDate: null,
    position: 0,
    sprintPosition: null,
    archived: false,
    deletedAt: null,
    createdById: 'u1',
    assignees: [],
    labels: [],
  }
}

function column(id: string, kind: BoardColumnRow['kind']): BoardColumnRow {
  return { id, pageId: 'p1', title: id, kind, position: 0, color: null }
}

describe('buildChildrenMap', () => {
  it('groups tasks by parentId and ignores top-level tasks', () => {
    const tasks = [task('a', null, 'c1'), task('b', 'a', 'c1'), task('c', 'a', 'c1')]
    const map = buildChildrenMap(tasks)
    expect(map.get('a')?.map((t) => t.id)).toEqual(['b', 'c'])
    expect(map.has('b')).toBe(false)
  })
})

describe('getChildren', () => {
  it('returns children for a parent', () => {
    const tasks = [task('a', null, 'c1'), task('b', 'a', 'c1')]
    const map = buildChildrenMap(tasks)
    expect(getChildren(map, 'a').map((t) => t.id)).toEqual(['b'])
  })

  it('returns an empty array for a task with no children', () => {
    const map = buildChildrenMap([task('a', null, 'c1')])
    expect(getChildren(map, 'a')).toEqual([])
  })
})

describe('subtaskProgress', () => {
  const columns = [column('active', 'ACTIVE'), column('done', 'DONE'), column('cx', 'CANCELLED')]

  it('counts only DONE children as done, with total including all', () => {
    const children = [task('b', 'a', 'active'), task('c', 'a', 'done'), task('d', 'a', 'cx')]
    expect(subtaskProgress(children, columns)).toEqual({ total: 3, done: 1, ratio: 1 / 3 })
  })

  it('returns ratio 1 when all children are done', () => {
    const children = [task('b', 'a', 'done'), task('c', 'a', 'done')]
    expect(subtaskProgress(children, columns)).toEqual({ total: 2, done: 2, ratio: 1 })
  })

  it('returns zeroes for no children', () => {
    expect(subtaskProgress([], columns)).toEqual({ total: 0, done: 0, ratio: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run test/kanban/hierarchy.test.ts`
Expected: FAIL — cannot resolve `@/components/kanban/lib/hierarchy`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/kanban/lib/hierarchy.ts`:

```ts
import type { BoardColumnRow, BoardTaskData } from '../types'

/** Group tasks by their parentId. Top-level tasks (parentId === null) are not keys. */
export function buildChildrenMap(tasks: BoardTaskData[]): Map<string, BoardTaskData[]> {
  const map = new Map<string, BoardTaskData[]>()
  for (const task of tasks) {
    if (!task.parentId) continue
    const siblings = map.get(task.parentId)
    if (siblings) {
      siblings.push(task)
    } else {
      map.set(task.parentId, [task])
    }
  }
  return map
}

/** Children of a given task, or an empty array when it has none. */
export function getChildren(
  map: Map<string, BoardTaskData[]>,
  taskId: string,
): BoardTaskData[] {
  return map.get(taskId) ?? []
}

export interface SubtaskProgress {
  readonly total: number
  readonly done: number
  readonly ratio: number
}

/** Progress over a task's children: done = child column kind is DONE. */
export function subtaskProgress(
  children: BoardTaskData[],
  columns: BoardColumnRow[],
): SubtaskProgress {
  const kindByColumn = new Map(columns.map((c) => [c.id, c.kind]))
  const total = children.length
  const done = children.filter((c) => kindByColumn.get(c.columnId) === 'DONE').length
  return { total, done, ratio: total === 0 ? 0 : done / total }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run test/kanban/hierarchy.test.ts`
Expected: PASS (3 describe blocks, 6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/lib/hierarchy.ts apps/web/test/kanban/hierarchy.test.ts
git commit -m "feat(kanban): add hierarchy helper for parent/child derivation"
```

---

## Task 2: `ParentBadge` shared component

**Files:**
- Create: `apps/web/src/components/kanban/components/parent-badge.tsx`
- Test: `apps/web/test/kanban/parent-badge.test.tsx`

The badge shows a tree icon + child count. It uses Russian plural forms for the tooltip ("1 подзадача", "2 подзадачи", "5 подзадач").

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/kanban/parent-badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'

import { subtaskWord } from '@/components/kanban/components/parent-badge'

describe('subtaskWord', () => {
  it('uses singular for 1', () => {
    expect(subtaskWord(1)).toBe('подзадача')
  })

  it('uses few-form for 2-4', () => {
    expect(subtaskWord(2)).toBe('подзадачи')
    expect(subtaskWord(3)).toBe('подзадачи')
    expect(subtaskWord(4)).toBe('подзадачи')
  })

  it('uses many-form for 0, 5-20', () => {
    expect(subtaskWord(5)).toBe('подзадач')
    expect(subtaskWord(11)).toBe('подзадач')
    expect(subtaskWord(0)).toBe('подзадач')
  })

  it('handles compound numbers', () => {
    expect(subtaskWord(21)).toBe('подзадача')
    expect(subtaskWord(22)).toBe('подзадачи')
    expect(subtaskWord(25)).toBe('подзадач')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run test/kanban/parent-badge.test.tsx`
Expected: FAIL — cannot resolve `@/components/kanban/components/parent-badge`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/components/kanban/components/parent-badge.tsx`:

```tsx
'use client'

import { AccountTreeIcon, Box, Tooltip } from '@repo/ui/components'

/** Russian plural for "подзадача" based on the standard pluralization rules. */
export function subtaskWord(n: number): string {
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 >= 11 && mod100 <= 14) return 'подзадач'
  if (mod10 === 1) return 'подзадача'
  if (mod10 >= 2 && mod10 <= 4) return 'подзадачи'
  return 'подзадач'
}

interface ParentBadgeProps {
  readonly count: number
}

export function ParentBadge({ count }: ParentBadgeProps) {
  return (
    <Tooltip title={`Родительская задача · ${count} ${subtaskWord(count)}`}>
      <Box
        component="span"
        aria-label={`Родительская задача, ${count} ${subtaskWord(count)}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.25,
          height: 20,
          px: 0.625,
          borderRadius: 1,
          bgcolor: 'action.hover',
          color: 'text.secondary',
          fontSize: 12,
          lineHeight: '20px',
          flexShrink: 0,
        }}
      >
        <AccountTreeIcon sx={{ fontSize: 14 }} />
        {count}
      </Box>
    </Tooltip>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run test/kanban/parent-badge.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/components/parent-badge.tsx apps/web/test/kanban/parent-badge.test.tsx
git commit -m "feat(kanban): add ParentBadge shared component"
```

---

## Task 3: Board card — childCount in model + badge + bold title

**Files:**
- Modify: `apps/web/src/components/kanban/views/board-card-model.ts`
- Modify: `apps/web/src/components/kanban/views/board-card.tsx`
- Test: `apps/web/test/kanban/board-card-model.test.ts` (existing — append)

The model gains a `childCount` field. `getBoardCardModel` already receives the full `board`, so it computes the count directly from `board.tasks` (a single `.filter`). This avoids prop-drilling a map through `BoardView → BoardColumn → BoardCard`.

- [ ] **Step 1: Add the failing test**

Append to `apps/web/test/kanban/board-card-model.test.ts` (inside the file, as a new `describe`). First read the file's existing imports — it already imports `getBoardCardModel` and builds `BoardData`/`BoardTaskData` fixtures. Add:

```ts
describe('getBoardCardModel childCount', () => {
  it('counts direct children of the task', () => {
    const parent = makeTask({ id: 'a' })
    const child1 = makeTask({ id: 'b', parentId: 'a' })
    const child2 = makeTask({ id: 'c', parentId: 'a' })
    const other = makeTask({ id: 'd' })
    const board = makeBoard({ tasks: [parent, child1, child2, other] })
    expect(getBoardCardModel(parent, board).childCount).toBe(2)
    expect(getBoardCardModel(other, board).childCount).toBe(0)
  })
})
```

NOTE: If the existing test file does not have reusable `makeTask`/`makeBoard` helpers, write inline fixtures matching the shapes already used elsewhere in that file. Read the file first and mirror its existing fixture style exactly (do not invent new helper names if the file uses inline objects).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run test/kanban/board-card-model.test.ts`
Expected: FAIL — `childCount` does not exist on `BoardCardModel` (TS error) / `undefined` !== 2.

- [ ] **Step 3: Add `childCount` to the model**

In `apps/web/src/components/kanban/views/board-card-model.ts`, add to the `BoardCardModel` interface (after `dateTone`):

```ts
  readonly childCount: number
```

In `getBoardCardModel`, add to the returned object (after `dateTone: getDateTone(dueDate, now),`):

```ts
    childCount: board.tasks.filter((t) => t.parentId === task.id).length,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run test/kanban/board-card-model.test.ts`
Expected: PASS (existing tests + new childCount test).

- [ ] **Step 5: Render badge + bold title in `board-card.tsx`**

In `apps/web/src/components/kanban/views/board-card.tsx`:

Add the import near the other local imports (after the `getBoardCardModel` import line):

```tsx
import { ParentBadge } from '../components/parent-badge'
```

Change the type/priority row condition (currently `model.type || model.priority`) to also show when there are children. Replace:

```tsx
              {model.type || model.priority ? (
```

with:

```tsx
              {model.type || model.priority || model.childCount > 0 ? (
```

Inside that `<Stack>`, add the badge as the first child (before the type `Chip`), i.e. immediately after the opening `<Stack ...>` tag of the type/priority row:

```tsx
                  {model.childCount > 0 ? <ParentBadge count={model.childCount} /> : null}
```

Make the title bold for parents. Replace the title `<Typography>`'s `fontWeight={600}` with:

```tsx
                fontWeight={model.childCount > 0 ? 700 : 600}
```

- [ ] **Step 6: Verify types + lint**

Run: `pnpm --filter web exec tsc --noEmit -p tsconfig.json` (or `pnpm --filter web check-types`)
Expected: no errors.
Run: `pnpm --filter web exec eslint src/components/kanban/views/board-card.tsx src/components/kanban/views/board-card-model.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/kanban/views/board-card.tsx apps/web/src/components/kanban/views/board-card-model.ts apps/web/test/kanban/board-card-model.test.ts
git commit -m "feat(kanban): highlight parent tasks on board cards"
```

---

## Task 4: Table row — badge + bold title for parents

**Files:**
- Modify: `apps/web/src/components/kanban/views/table-view.tsx`
- Modify: `apps/web/src/components/kanban/views/sprint-section.tsx`

`TaskRow` (defined inside `sprint-section.tsx`) already receives `allTasks` and `columns` via the `SprintSection` props. We compute a children map once in `table-view.tsx`, pass it through `SprintSection` to each `TaskRow`. Because `SprintSection` is used for both sprint sections and the backlog section, the prop must be threaded to both render sites.

- [ ] **Step 1: Read the current prop shapes**

Read `apps/web/src/components/kanban/views/sprint-section.tsx` fully. Identify:
- The `SprintSection` props interface (note `allTasks: BoardTaskData[]`, `columns: BoardColumnRow[]` exist on the `kind: 'sprint'` variant around line 72).
- The internal `TaskRow` component props and where `task.title` is rendered (around line 154-163).
- How `SprintSection` passes data down to `TaskRow`.

This task has no unit test (it's presentational threading); verification is via `check-types` + lint + a manual render check in Task 7.

- [ ] **Step 2: Add `childrenMap` to SprintSection props**

In `sprint-section.tsx`, add to the `SprintSection` props (both the shared base and ensure it is available regardless of `kind`) and to the `TaskRow` props:

For `SprintSection` props interface, add:

```ts
  readonly childrenMap: Map<string, BoardTaskData[]>
```

(Add it to whichever props type both the `sprint` and `backlog` variants share; if they are a discriminated union, add it to each variant so both sections receive it. Import `BoardTaskData` if not already imported.)

For the internal `TaskRow` props interface, add:

```ts
  readonly childCount: number
```

- [ ] **Step 3: Thread the map into each TaskRow**

In `SprintSection`, where each `TaskRow` is rendered for a `task`, pass:

```tsx
childCount={props.childrenMap.get(task.id)?.length ?? 0}
```

(Use the actual prop accessor the file uses — it may destructure props or reference `props.childrenMap`. Match the surrounding code.)

- [ ] **Step 4: Render badge + bold title in TaskRow**

Add the import at the top of `sprint-section.tsx`:

```tsx
import { ParentBadge } from '../components/parent-badge'
```

In `TaskRow`, immediately before the title `<Typography>` (the one rendering `{task.title}`, ~line 154), add:

```tsx
      {childCount > 0 ? <ParentBadge count={childCount} /> : null}
```

Make the title bold for parents — add `fontWeight` to that `<Typography>`'s `sx`:

```tsx
          fontWeight: childCount > 0 ? 600 : undefined,
```

(Add this line inside the existing `sx={{ ... }}` object for the title Typography, alongside `flex: 1`.)

- [ ] **Step 5: Build the map and pass it from `table-view.tsx`**

In `apps/web/src/components/kanban/views/table-view.tsx`:

Add the import:

```tsx
import { buildChildrenMap } from '../lib/hierarchy'
```

Add a memo near the existing `grouped` memo:

```tsx
  const childrenMap = useMemo(() => buildChildrenMap(board.tasks), [board.tasks])
```

Pass `childrenMap={childrenMap}` to BOTH `<SprintSection>` render sites (the sprint loop one and the backlog one).

- [ ] **Step 6: Verify types + lint**

Run: `pnpm --filter web check-types`
Expected: no errors.
Run: `pnpm --filter web exec eslint src/components/kanban/views/sprint-section.tsx src/components/kanban/views/table-view.tsx`
Expected: clean.

- [ ] **Step 7: Run existing sprint-section test**

Run: `pnpm --filter web exec vitest run test/kanban/sprint-section.test.tsx`
Expected: PASS. If the test constructs `<SprintSection>` directly and now fails because `childrenMap` is required, add `childrenMap={new Map()}` to the test's render call (a minimal, correct fixture).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/kanban/views/sprint-section.tsx apps/web/src/components/kanban/views/table-view.tsx apps/web/test/kanban/sprint-section.test.tsx
git commit -m "feat(kanban): highlight parent tasks in table view"
```

---

## Task 5: Gantt — saturated palette for parent bars

**Files:**
- Modify: `apps/web/src/components/kanban/views/gantt-view.tsx`

Parent bars use a darker/more saturated variant of the same status-family color. Selection is based on whether the task has children. No striping (out of scope — `gantt-task-react` has no native pattern support).

- [ ] **Step 1: Add the parent palette + child detection**

In `apps/web/src/components/kanban/views/gantt-view.tsx`:

Add a parent palette constant next to the existing `COLUMN_COLORS`:

```tsx
const PARENT_COLUMN_COLORS: Record<BoardData['columns'][number]['kind'], { bg: string; selected: string }> = {
  ACTIVE: { bg: '#1d4ed8', selected: '#1e40af' },
  DONE: { bg: '#15803d', selected: '#166534' },
  CANCELLED: { bg: '#6b7280', selected: '#4b5563' },
}
```

Add the import at the top (with the other local imports):

```tsx
import { buildChildrenMap } from '../lib/hierarchy'
```

- [ ] **Step 2: Use the palette per task**

Inside the `useMemo` that builds `ganttTasks`, before the `.map`, build the map once:

```tsx
    const childrenMap = buildChildrenMap(visibleTasks)
```

Inside the `.map` callback, after the existing `const col = ...` line, replace the palette selection:

```tsx
        const col = board.columns.find((c) => c.id === t.columnId)
        const isParent = (childrenMap.get(t.id)?.length ?? 0) > 0
        const palette = (isParent ? PARENT_COLUMN_COLORS : COLUMN_COLORS)[col?.kind ?? 'ACTIVE']
```

(Replace the existing `const palette = COLUMN_COLORS[col?.kind ?? 'ACTIVE']` line with the two lines above.)

Note: `childrenMap` is built from `visibleTasks`, so a parent whose children are filtered out of the current view still highlights only if at least one child is in `visibleTasks`. This is acceptable — the Gantt only renders tasks with dates anyway. Keep the existing `dependencies: t.parentId ? [t.parentId] : undefined`.

- [ ] **Step 3: Verify types + lint**

Run: `pnpm --filter web check-types`
Expected: no errors.
Run: `pnpm --filter web exec eslint src/components/kanban/views/gantt-view.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/kanban/views/gantt-view.tsx
git commit -m "feat(kanban): saturate parent task bars in Gantt view"
```

---

## Task 6: `SubtasksSection` in task detail view

**Files:**
- Create: `apps/web/src/components/kanban/task/subtasks-section.tsx`
- Modify: `apps/web/src/components/kanban/task/task-form.tsx`

The section renders only when the task has children. It shows a heading + "выполнено N из M" counter, a `LinearProgress` bar, and a clickable list of children with a status color dot + status label. Clicking a child navigates to its detail by replacing the `taskId` search param (same mechanism the cards use). It renders in both editable and read-only modes.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/kanban/subtasks-section.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

import { childStatusColor } from '@/components/kanban/task/subtasks-section'
import type { BoardColumnRow } from '@/components/kanban/types'

function column(
  id: string,
  kind: BoardColumnRow['kind'],
  color: string | null,
): BoardColumnRow {
  return { id, pageId: 'p1', title: id, kind, position: 0, color }
}

describe('childStatusColor', () => {
  it('prefers the column custom color', () => {
    expect(childStatusColor(column('c', 'ACTIVE', '#abcdef'))).toBe('#abcdef')
  })

  it('falls back to kind default when no color', () => {
    expect(childStatusColor(column('c', 'DONE', null))).toBe('#22c55e')
    expect(childStatusColor(column('c', 'ACTIVE', null))).toBe('#3b82f6')
    expect(childStatusColor(column('c', 'CANCELLED', null))).toBe('#9ca3af')
  })

  it('falls back to a neutral grey when the column is missing', () => {
    expect(childStatusColor(undefined)).toBe('#9ca3af')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run test/kanban/subtasks-section.test.ts`
Expected: FAIL — cannot resolve `@/components/kanban/task/subtasks-section`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/kanban/task/subtasks-section.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Box, LinearProgress, Stack, Typography } from '@repo/ui/components'

import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'
import { subtaskProgress } from '../lib/hierarchy'

const KIND_DEFAULT_COLOR: Record<BoardColumnRow['kind'], string> = {
  ACTIVE: '#3b82f6',
  DONE: '#22c55e',
  CANCELLED: '#9ca3af',
}

/** Status dot color for a child: column custom color, else kind default, else neutral. */
export function childStatusColor(column: BoardColumnRow | undefined): string {
  if (!column) return '#9ca3af'
  return column.color ?? KIND_DEFAULT_COLOR[column.kind]
}

interface SubtasksSectionProps {
  readonly children: BoardTaskData[]
  readonly board: BoardData
}

export function SubtasksSection({ children, board }: SubtasksSectionProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const columnById = useMemo(
    () => new Map(board.columns.map((c) => [c.id, c])),
    [board.columns],
  )
  const progress = useMemo(
    () => subtaskProgress(children, board.columns),
    [children, board.columns],
  )

  if (children.length === 0) return null

  function openChild(taskId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('taskId', taskId)
    router.replace(`?${params.toString()}`)
  }

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          Подзадачи
        </Typography>
        <Typography variant="caption" color="text.secondary">
          выполнено {progress.done} из {progress.total}
        </Typography>
      </Stack>

      <LinearProgress
        variant="determinate"
        value={progress.ratio * 100}
        sx={{ mb: 1.5, height: 6, borderRadius: 3 }}
      />

      <Stack spacing={0.25}>
        {children.map((child) => {
          const column = columnById.get(child.columnId)
          return (
            <Stack
              key={child.id}
              direction="row"
              alignItems="center"
              spacing={1}
              onClick={() => openChild(child.id)}
              sx={{
                py: 0.75,
                px: 1,
                borderRadius: 1,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: childStatusColor(column),
                  flexShrink: 0,
                }}
              />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {child.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                {column?.title ?? ''}
              </Typography>
            </Stack>
          )
        })}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run test/kanban/subtasks-section.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into `task-form.tsx`**

In `apps/web/src/components/kanban/task/task-form.tsx`:

Add the imports (with the other local imports near `TaskAttachments`):

```tsx
import { SubtasksSection } from './subtasks-section'
import { buildChildrenMap, getChildren } from '../lib/hierarchy'
```

Add a memo for this task's children inside the `TaskForm` body (near the existing `parentCandidates` memo):

```tsx
  const subtasks = useMemo(
    () => getChildren(buildChildrenMap(board.tasks), task.id),
    [board.tasks, task.id],
  )
```

Render the section right after the `<Section heading="Описание">…</Section>` block (which ends at the line with `</Section>`), and before the editable-only `TaskAttachments` block. Insert:

```tsx
        <SubtasksSection children={subtasks} board={board} />
```

`SubtasksSection` returns `null` when there are no children, so no extra guard is needed and it renders in both editable and read-only modes.

- [ ] **Step 6: Verify types + lint**

Run: `pnpm --filter web check-types`
Expected: no errors.
Run: `pnpm --filter web exec eslint src/components/kanban/task/subtasks-section.tsx src/components/kanban/task/task-form.tsx`
Expected: clean.

- [ ] **Step 7: Run existing task-form test**

Run: `pnpm --filter web exec vitest run test/kanban/task-form.test.tsx`
Expected: PASS. If it renders `<TaskForm>` with a board fixture and breaks, ensure the fixture's `board.columns` is an array (it already is) — no signature change to `TaskForm` was made, so it should pass unchanged.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/kanban/task/subtasks-section.tsx apps/web/src/components/kanban/task/task-form.tsx apps/web/test/kanban/subtasks-section.test.ts
git commit -m "feat(kanban): add subtasks block with progress to task detail"
```

---

## Task 7: Full gates + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter web test`
Expected: all tests pass.

- [ ] **Step 2: Run the merge gates**

Run: `pnpm gates`
Expected: check-types + lint + build + test all green. (This catches RSC boundary issues and the architecture-layering check. `subtasks-section.tsx` and `parent-badge.tsx` are `'use client'`, and they deep-import the pure leaf `../lib/hierarchy` — consistent with the client-component deep-import rule for domain leaves; these are local kanban modules, not `@repo/domain`, so no layering violation.)

- [ ] **Step 3: Manual verification in the running app**

Start infra + web if not already running:

```bash
docker compose up -d
pnpm --filter web dev
```

In a Kanban page with at least one parent task (a task that has children) and some subtasks across different columns (incl. one DONE):
- **Board view:** the parent card shows the tree badge with the child count and a bolder title; non-parent cards are unchanged.
- **Table view:** the parent row shows the badge + bolder title.
- **Gantt view:** give the parent and a child dates; the parent bar is visibly darker/more saturated than child bars of the same status; the dependency arrow still links them.
- **Detail view:** open the parent → a "Подзадачи" block appears under the description with a progress bar and "выполнено N из M"; each row has a status-colored dot + the column title; clicking a child opens that child's detail.
- Open a task with no children → no "Подзадачи" block, no badge, normal-weight title.

Report what you observed for each view.

- [ ] **Step 4: Final state check**

Run: `git status` and `git log --oneline main..HEAD`
Expected: clean working tree, 6 feature commits (Tasks 1–6) on `feat/parent-task-hierarchy` plus the earlier spec commit.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Gantt color coding (spec §1) → Task 5. Board card badge + bold title (spec §2) → Task 3. Table consistency → Task 4. Subtasks block + clickable children + status indicator + progress bar (spec §3 incl. the "optional" progress bar, which we include) → Task 6. Pure helper + tests → Task 1. Shared badge → Task 2.
- **No backend changes:** confirmed — every task touches only `apps/web`. No Prisma/tRPC/domain edits.
- **Type consistency:** `BoardTaskData`, `BoardColumnRow`, `BoardData` used verbatim from `types.ts`. `buildChildrenMap`/`getChildren`/`subtaskProgress`/`SubtaskProgress` names are consistent across Tasks 1, 4, 5, 6. `subtaskWord` and `ParentBadge` consistent across Tasks 2, 3, 4. `childStatusColor` defined and tested in Task 6.
- **Parent definition:** `children.length > 0` enforced everywhere (board via `model.childCount > 0`, table via `childCount > 0`, Gantt via `childrenMap` lookup, detail via `children.length === 0 → null`).
```
