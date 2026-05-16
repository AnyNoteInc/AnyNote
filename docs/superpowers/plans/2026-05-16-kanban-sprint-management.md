# Kanban Sprint Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sprint lifecycle controls (start / complete / edit / delete) to the kanban table view via a three-dot menu, translate status badges to Russian, show sprint dates inline, highlight the active sprint, and default the sprint filter to "current" on fresh visits with an active sprint.

**Architecture:** Backend gains one extended mutation input (`sprint.complete.moveUndoneTo`). Frontend adds five new files in `components/kanban/sprint/` (form-fields extraction, edit/complete/delete dialogs, menu) plus a refactor of `views/sprint-section.tsx` and a small option on `useKanbanFilters`. No new framework, no new API surface beyond the one extended input.

**Tech Stack:** TypeScript / React 19 / Next.js 16 App Router / MUI v6 / tRPC v11 / Prisma 7 / `@hello-pangea/dnd` (already used) / Vitest / Playwright.

**Spec:** [docs/superpowers/specs/2026-05-16-kanban-sprint-management-design.md](../specs/2026-05-16-kanban-sprint-management-design.md)

---

## File Plan

**Create:**
- `apps/web/src/components/kanban/sprint/sprint-form-fields.tsx` — extracted Stack of name/description/dates inputs, shared by create and edit
- `apps/web/src/components/kanban/sprint/sprint-edit-dialog.tsx` — edit dialog (clone of create, pre-filled)
- `apps/web/src/components/kanban/sprint/sprint-complete-dialog.tsx` — done/undone counts + destination picker
- `apps/web/src/components/kanban/sprint/sprint-delete-dialog.tsx` — confirm with task count
- `apps/web/src/components/kanban/sprint/sprint-menu.tsx` — three-dot menu with start/complete/edit/delete actions
- `apps/web/src/components/kanban/sprint/sprint-status-label.ts` — `sprintStatusLabel(status)` helper
- `apps/web/src/components/kanban/sprint/pluralize-ru.ts` — `pluralizeRu(n, forms)` helper
- `apps/web/test/sprint-status-label.test.ts`
- `apps/web/test/pluralize-ru.test.ts`
- `apps/e2e/sprint-lifecycle.spec.ts` — E2E spec

**Modify:**
- `packages/trpc/src/routers/kanban/sprint.ts` — extend `complete` with `moveUndoneTo`
- `packages/trpc/test/kanban-sprint.test.ts` — new tests for `complete`
- `apps/web/src/components/kanban/sprint/sprint-create-dialog.tsx` — refactor to use `SprintFormFields`
- `apps/web/src/components/kanban/views/sprint-section.tsx` — new header layout, status badge, dates, active-sprint accent, menu slot, props discriminator
- `apps/web/src/components/kanban/views/table-view.tsx` — call `SprintSection` with new props shape
- `apps/web/src/components/kanban/use-kanban-filters.ts` — add `defaultSprint` option
- `apps/web/src/components/kanban/kanban-board-page.tsx` — pass `defaultSprint` based on `board.sprints`
- `packages/ui/src/components/index.ts` — re-export `PlayArrowIcon` and `FlagIcon`

---

## Task 1: Backend tests for sprint.complete with moveUndoneTo

**Files:**
- Modify: `packages/trpc/test/kanban-sprint.test.ts`

- [ ] **Step 1: Append five failing test cases**

Open `packages/trpc/test/kanban-sprint.test.ts` and append at the end of the file (after the `kanban.sprint.create` describe block at line 114):

```ts
describe('kanban.sprint.complete', () => {
  const SPRINT_TARGET = '00000000-0000-0000-0000-0000000000b1'
  const SPRINT_DEST = '00000000-0000-0000-0000-0000000000b2'
  const OTHER_PAGE = '00000000-0000-0000-0000-0000000000c1'
  const COL_ACTIVE = '00000000-0000-0000-0000-0000000000d1'
  const COL_DONE = '00000000-0000-0000-0000-0000000000d2'

  function buildPrismaWithColumns(opts: { destPageId?: string } = {}): {
    prisma: PrismaClient
    sprintUpdate: ReturnType<typeof vi.fn>
    taskUpdateMany: ReturnType<typeof vi.fn>
  } {
    const destPageId = opts.destPageId ?? PAGE_ID
    const sprintUpdate = vi.fn().mockResolvedValue({})
    const taskUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
    const txClient = {
      kanbanColumn: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: COL_ACTIVE, kind: 'ACTIVE' },
            { id: COL_DONE, kind: 'DONE' },
          ]),
      },
      sprint: {
        findUnique: vi
          .fn()
          .mockImplementation(({ where: { id } }: { where: { id: string } }) => {
            if (id === SPRINT_TARGET) return Promise.resolve({ id, pageId: PAGE_ID })
            if (id === SPRINT_DEST) return Promise.resolve({ id, pageId: destPageId })
            return Promise.resolve(null)
          }),
        update: sprintUpdate,
      },
      task: { updateMany: taskUpdateMany },
    }
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient
    return { prisma, sprintUpdate, taskUpdateMany }
  }

  it('moves undone tasks (ACTIVE-kind columns) to destination sprint and flips status', async () => {
    const { prisma, sprintUpdate, taskUpdateMany } = buildPrismaWithColumns()
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await caller.complete({
      pageId: PAGE_ID,
      id: SPRINT_TARGET,
      moveUndoneTo: SPRINT_DEST,
    })

    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { sprintId: SPRINT_TARGET, columnId: { in: [COL_ACTIVE] } },
      data: { sprintId: SPRINT_DEST, sprintPosition: null },
    })
    expect(sprintUpdate).toHaveBeenCalledWith({
      where: { id: SPRINT_TARGET },
      data: { status: 'COMPLETED' },
    })
  })

  it('moves undone tasks to backlog when moveUndoneTo is null', async () => {
    const { prisma, taskUpdateMany } = buildPrismaWithColumns()
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await caller.complete({ pageId: PAGE_ID, id: SPRINT_TARGET, moveUndoneTo: null })

    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { sprintId: SPRINT_TARGET, columnId: { in: [COL_ACTIVE] } },
      data: { sprintId: null, sprintPosition: null },
    })
  })

  it('rejects moveUndoneTo pointing to a sprint on a different page', async () => {
    const { prisma, sprintUpdate, taskUpdateMany } = buildPrismaWithColumns({
      destPageId: OTHER_PAGE,
    })
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await expect(
      caller.complete({ pageId: PAGE_ID, id: SPRINT_TARGET, moveUndoneTo: SPRINT_DEST }),
    ).rejects.toThrow(/спринт/i)
    expect(taskUpdateMany).not.toHaveBeenCalled()
    expect(sprintUpdate).not.toHaveBeenCalled()
  })

  it('rejects moveUndoneTo equal to the sprint being completed', async () => {
    const { prisma, taskUpdateMany, sprintUpdate } = buildPrismaWithColumns()
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await expect(
      caller.complete({ pageId: PAGE_ID, id: SPRINT_TARGET, moveUndoneTo: SPRINT_TARGET }),
    ).rejects.toThrow(/спринт/i)
    expect(taskUpdateMany).not.toHaveBeenCalled()
    expect(sprintUpdate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the new tests, expect all five to FAIL**

Run: `pnpm --filter @repo/trpc test -- kanban-sprint`

Expected: The `kanban.sprint.complete` describe block fails — the current `complete` procedure does not accept `moveUndoneTo`, does not query columns, does not call `task.updateMany`. The two existing `kanban.sprint.activate` and `kanban.sprint.create` describes still pass.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/trpc/test/kanban-sprint.test.ts
git commit -m "test(kanban): failing tests for sprint.complete moveUndoneTo"
```

---

## Task 2: Implement sprint.complete with moveUndoneTo

**Files:**
- Modify: `packages/trpc/src/routers/kanban/sprint.ts`

- [ ] **Step 1: Replace the `complete` procedure**

Open `packages/trpc/src/routers/kanban/sprint.ts`. Replace lines 96-106 (the existing `complete` procedure) with:

```ts
  complete: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        moveUndoneTo: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      if (input.moveUndoneTo === input.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Невозможно перенести задачи в тот же спринт',
        })
      }
      await ctx.prisma.$transaction(async (tx) => {
        if (input.moveUndoneTo) {
          const dest = await tx.sprint.findUnique({
            where: { id: input.moveUndoneTo },
            select: { id: true, pageId: true },
          })
          if (!dest || dest.pageId !== page.id) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Целевой спринт не найден на этой доске',
            })
          }
        }
        const undoneColumns = await tx.kanbanColumn.findMany({
          where: { pageId: page.id, kind: 'ACTIVE' },
          select: { id: true },
        })
        const undoneColumnIds = undoneColumns.map((c) => c.id)
        await tx.task.updateMany({
          where: { sprintId: input.id, columnId: { in: undoneColumnIds } },
          data: { sprintId: input.moveUndoneTo, sprintPosition: null },
        })
        await tx.sprint.update({
          where: { id: input.id },
          data: { status: 'COMPLETED' },
        })
      })
      kanbanBus.emit(page.id, { kind: 'sprint.upserted', sprintId: input.id })
      if (input.moveUndoneTo) {
        kanbanBus.emit(page.id, { kind: 'sprint.upserted', sprintId: input.moveUndoneTo })
      }
      return { ok: true as const }
    }),
```

- [ ] **Step 2: Run the tests, expect all five to PASS**

Run: `pnpm --filter @repo/trpc test -- kanban-sprint`

Expected: All four cases in `kanban.sprint.complete` pass, plus the pre-existing `activate` and `create` cases still pass.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/trpc check-types`
Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/kanban/sprint.ts
git commit -m "feat(trpc): sprint.complete accepts moveUndoneTo destination"
```

---

## Task 3: pluralize-ru helper

**Files:**
- Create: `apps/web/src/components/kanban/sprint/pluralize-ru.ts`
- Create: `apps/web/test/pluralize-ru.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/pluralize-ru.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { pluralizeRu } from '@/components/kanban/sprint/pluralize-ru'

const FORMS: [string, string, string] = ['задача', 'задачи', 'задач']

describe('pluralizeRu', () => {
  it('returns form-0 (singular) for 1 and 21', () => {
    expect(pluralizeRu(1, FORMS)).toBe('задача')
    expect(pluralizeRu(21, FORMS)).toBe('задача')
  })

  it('returns form-1 (paucal) for 2-4, 22-24', () => {
    expect(pluralizeRu(2, FORMS)).toBe('задачи')
    expect(pluralizeRu(3, FORMS)).toBe('задачи')
    expect(pluralizeRu(4, FORMS)).toBe('задачи')
    expect(pluralizeRu(22, FORMS)).toBe('задачи')
  })

  it('returns form-2 (plural) for 0, 5-20, 25', () => {
    expect(pluralizeRu(0, FORMS)).toBe('задач')
    expect(pluralizeRu(5, FORMS)).toBe('задач')
    expect(pluralizeRu(11, FORMS)).toBe('задач')
    expect(pluralizeRu(14, FORMS)).toBe('задач')
    expect(pluralizeRu(20, FORMS)).toBe('задач')
    expect(pluralizeRu(25, FORMS)).toBe('задач')
  })

  it('handles teens (11-14) with form-2 not form-1', () => {
    expect(pluralizeRu(11, FORMS)).toBe('задач')
    expect(pluralizeRu(12, FORMS)).toBe('задач')
    expect(pluralizeRu(13, FORMS)).toBe('задач')
    expect(pluralizeRu(14, FORMS)).toBe('задач')
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter web test -- pluralize-ru`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/components/kanban/sprint/pluralize-ru.ts`:

```ts
export function pluralizeRu(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod100 >= 11 && mod100 <= 14) return forms[2]
  if (mod10 === 1) return forms[0]
  if (mod10 >= 2 && mod10 <= 4) return forms[1]
  return forms[2]
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `pnpm --filter web test -- pluralize-ru`
Expected: all 4 cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/sprint/pluralize-ru.ts apps/web/test/pluralize-ru.test.ts
git commit -m "feat(kanban): pluralize-ru helper"
```

---

## Task 4: sprint-status-label helper

**Files:**
- Create: `apps/web/src/components/kanban/sprint/sprint-status-label.ts`
- Create: `apps/web/test/sprint-status-label.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/sprint-status-label.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { sprintStatusLabel, sprintStatusColor } from '@/components/kanban/sprint/sprint-status-label'

describe('sprintStatusLabel', () => {
  it('translates PLANNED', () => {
    expect(sprintStatusLabel('PLANNED')).toBe('Планирование')
  })
  it('translates ACTIVE', () => {
    expect(sprintStatusLabel('ACTIVE')).toBe('Активный')
  })
  it('translates COMPLETED', () => {
    expect(sprintStatusLabel('COMPLETED')).toBe('Завершён')
  })
  it('returns the raw value for an unknown status', () => {
    expect(sprintStatusLabel('UNKNOWN')).toBe('UNKNOWN')
  })
})

describe('sprintStatusColor', () => {
  it('maps PLANNED to default', () => {
    expect(sprintStatusColor('PLANNED')).toBe('default')
  })
  it('maps ACTIVE to primary', () => {
    expect(sprintStatusColor('ACTIVE')).toBe('primary')
  })
  it('maps COMPLETED to success', () => {
    expect(sprintStatusColor('COMPLETED')).toBe('success')
  })
  it('maps unknown to default', () => {
    expect(sprintStatusColor('UNKNOWN')).toBe('default')
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `pnpm --filter web test -- sprint-status-label`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/src/components/kanban/sprint/sprint-status-label.ts`:

```ts
export type SprintStatusChipColor = 'default' | 'primary' | 'success'

export function sprintStatusLabel(status: string): string {
  switch (status) {
    case 'PLANNED':
      return 'Планирование'
    case 'ACTIVE':
      return 'Активный'
    case 'COMPLETED':
      return 'Завершён'
    default:
      return status
  }
}

export function sprintStatusColor(status: string): SprintStatusChipColor {
  switch (status) {
    case 'ACTIVE':
      return 'primary'
    case 'COMPLETED':
      return 'success'
    default:
      return 'default'
  }
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `pnpm --filter web test -- sprint-status-label`
Expected: 8 cases pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/sprint/sprint-status-label.ts apps/web/test/sprint-status-label.test.ts
git commit -m "feat(kanban): sprint status label/color helpers"
```

---

## Task 5: Export PlayArrow and Flag icons from @repo/ui

**Files:**
- Modify: `packages/ui/src/components/index.ts`

- [ ] **Step 1: Add the two icon re-exports**

Open `packages/ui/src/components/index.ts`. Find the line `export { default as EditIcon } from '@mui/icons-material/Edit'` (around line 82). Add immediately after it:

```ts
export { default as PlayArrowIcon } from '@mui/icons-material/PlayArrow'
export { default as FlagIcon } from '@mui/icons-material/Flag'
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/ui check-types`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): export PlayArrow and Flag icons for sprint menu"
```

---

## Task 6: Extract SprintFormFields, refactor SprintCreateDialog

**Files:**
- Create: `apps/web/src/components/kanban/sprint/sprint-form-fields.tsx`
- Modify: `apps/web/src/components/kanban/sprint/sprint-create-dialog.tsx`

- [ ] **Step 1: Create the shared form fields component**

Create `apps/web/src/components/kanban/sprint/sprint-form-fields.tsx`:

```tsx
'use client'

import {
  AdapterDateFns,
  Box,
  DatePicker,
  LocalizationProvider,
  Stack,
  TextField,
  Typography,
  dateFnsRu,
} from '@repo/ui/components'

export interface SprintFormValues {
  name: string
  description: string
  startDate: Date | null
  endDate: Date | null
}

interface SprintFormFieldsProps {
  readonly values: SprintFormValues
  readonly onChange: (next: SprintFormValues) => void
  readonly autoFocusName?: boolean
}

export function SprintFormFields({ values, onChange, autoFocusName }: SprintFormFieldsProps) {
  function patch(partial: Partial<SprintFormValues>) {
    onChange({ ...values, ...partial })
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Название"
          value={values.name}
          onChange={(e) => patch({ name: e.target.value })}
          fullWidth
          autoFocus={autoFocusName}
        />
        <TextField
          label="Описание"
          value={values.description}
          onChange={(e) => patch({ description: e.target.value })}
          multiline
          minRows={2}
          fullWidth
        />
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.5 }}
          >
            Период
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <DatePicker
              label="Старт"
              value={values.startDate}
              onChange={(value) => {
                const next: Partial<SprintFormValues> = { startDate: value }
                if (values.endDate && value && value > values.endDate) next.endDate = null
                patch(next)
              }}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
            <Typography color="text.secondary">—</Typography>
            <DatePicker
              label="Финиш"
              value={values.endDate}
              minDate={values.startDate ?? undefined}
              onChange={(value) => patch({ endDate: value })}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
          </Stack>
        </Box>
      </Stack>
    </LocalizationProvider>
  )
}
```

- [ ] **Step 2: Refactor SprintCreateDialog to use SprintFormFields**

Open `apps/web/src/components/kanban/sprint/sprint-create-dialog.tsx`. Replace the entire file with:

```tsx
'use client'

import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SprintFormFields, type SprintFormValues } from './sprint-form-fields'

interface SprintCreateDialogProps {
  readonly pageId: string
  readonly open: boolean
  readonly onClose: () => void
}

const EMPTY: SprintFormValues = { name: '', description: '', startDate: null, endDate: null }

export function SprintCreateDialog({ pageId, open, onClose }: SprintCreateDialogProps) {
  const utils = trpc.useUtils()
  const create = trpc.kanban.sprint.create.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      setValues(EMPTY)
      onClose()
    },
  })
  const [values, setValues] = useState<SprintFormValues>(EMPTY)

  function submit() {
    create.mutate({
      pageId,
      name: values.name,
      description: values.description || undefined,
      startDate: values.startDate,
      endDate: values.endDate,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Новый спринт</DialogTitle>
      <DialogContent>
        <SprintFormFields values={values} onChange={setValues} autoFocusName />
        {create.error ? (
          <Box sx={{ mt: 1, color: 'error.main', fontSize: 14 }}>{create.error.message}</Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          onClick={submit}
          variant="contained"
          disabled={!values.name || create.isPending}
        >
          Создать
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

Also add `Box` to the imports (replace the import line):

```tsx
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@repo/ui/components'
```

- [ ] **Step 3: Type-check and lint**

Run in parallel:
- `pnpm --filter web check-types`
- `pnpm --filter web lint`

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/kanban/sprint/sprint-form-fields.tsx apps/web/src/components/kanban/sprint/sprint-create-dialog.tsx
git commit -m "refactor(kanban): extract SprintFormFields shared by create/edit"
```

---

## Task 7: SprintEditDialog

**Files:**
- Create: `apps/web/src/components/kanban/sprint/sprint-edit-dialog.tsx`

- [ ] **Step 1: Create the dialog**

Create `apps/web/src/components/kanban/sprint/sprint-edit-dialog.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SprintFormFields, type SprintFormValues } from './sprint-form-fields'

interface SprintLike {
  readonly id: string
  readonly name: string
  readonly description?: string | null
  readonly startDate?: Date | string | null
  readonly endDate?: Date | string | null
}

interface SprintEditDialogProps {
  readonly pageId: string
  readonly sprint: SprintLike
  readonly open: boolean
  readonly onClose: () => void
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

export function SprintEditDialog({ pageId, sprint, open, onClose }: SprintEditDialogProps) {
  const utils = trpc.useUtils()
  const update = trpc.kanban.sprint.update.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      onClose()
    },
  })

  const original = useMemo<SprintFormValues>(
    () => ({
      name: sprint.name,
      description: sprint.description ?? '',
      startDate: toDate(sprint.startDate),
      endDate: toDate(sprint.endDate),
    }),
    [sprint],
  )
  const [values, setValues] = useState<SprintFormValues>(original)

  const dirty =
    values.name !== original.name ||
    values.description !== original.description ||
    (values.startDate?.getTime() ?? null) !== (original.startDate?.getTime() ?? null) ||
    (values.endDate?.getTime() ?? null) !== (original.endDate?.getTime() ?? null)

  function submit() {
    update.mutate({
      pageId,
      id: sprint.id,
      name: values.name,
      description: values.description || null,
      startDate: values.startDate,
      endDate: values.endDate,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Изменить спринт</DialogTitle>
      <DialogContent>
        <SprintFormFields values={values} onChange={setValues} autoFocusName />
        {update.error ? (
          <Box sx={{ mt: 1, color: 'error.main', fontSize: 14 }}>{update.error.message}</Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          onClick={submit}
          variant="contained"
          disabled={!values.name || !dirty || update.isPending}
        >
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/kanban/sprint/sprint-edit-dialog.tsx
git commit -m "feat(kanban): sprint edit dialog"
```

---

## Task 8: SprintCompleteDialog

**Files:**
- Create: `apps/web/src/components/kanban/sprint/sprint-complete-dialog.tsx`

- [ ] **Step 1: Create the dialog**

Create `apps/web/src/components/kanban/sprint/sprint-complete-dialog.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'

interface SprintCompleteDialogProps {
  readonly pageId: string
  readonly sprint: { readonly id: string; readonly name: string }
  readonly tasks: BoardTaskData[]
  readonly columns: BoardColumnRow[]
  readonly otherSprints: BoardData['sprints']
  readonly open: boolean
  readonly onClose: () => void
}

const BACKLOG_VALUE = '__backlog__'

export function SprintCompleteDialog({
  pageId,
  sprint,
  tasks,
  columns,
  otherSprints,
  open,
  onClose,
}: SprintCompleteDialogProps) {
  const utils = trpc.useUtils()
  const complete = trpc.kanban.sprint.complete.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      onClose()
    },
  })

  const { doneCount, undoneCount } = useMemo(() => {
    const undoneColumnIds = new Set(
      columns.filter((c) => c.kind === 'ACTIVE').map((c) => c.id),
    )
    const sprintTasks = tasks.filter((t) => t.sprintId === sprint.id)
    const undone = sprintTasks.filter((t) => undoneColumnIds.has(t.columnId))
    return { doneCount: sprintTasks.length - undone.length, undoneCount: undone.length }
  }, [tasks, columns, sprint.id])

  const plannedSprints = useMemo(
    () =>
      otherSprints
        .filter((s) => s.id !== sprint.id && s.status === 'PLANNED')
        .sort((a, b) => a.position - b.position),
    [otherSprints, sprint.id],
  )

  const [destination, setDestination] = useState<string>(
    plannedSprints[0]?.id ?? BACKLOG_VALUE,
  )

  function submit() {
    complete.mutate({
      pageId,
      id: sprint.id,
      moveUndoneTo: destination === BACKLOG_VALUE ? null : destination,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Завершить спринт «{sprint.name}»</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={4} sx={{ mt: 1, mb: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Выполнено
            </Typography>
            <Typography variant="h4">{doneCount}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Не выполнено
            </Typography>
            <Typography variant="h4">{undoneCount}</Typography>
          </Box>
        </Stack>

        {undoneCount > 0 ? (
          <>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Куда перенести невыполненные задачи?
            </Typography>
            <TextField
              select
              fullWidth
              size="small"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              {plannedSprints.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
              <MenuItem value={BACKLOG_VALUE}>Беклог</MenuItem>
            </TextField>
          </>
        ) : null}

        {complete.error ? (
          <Box sx={{ mt: 1, color: 'error.main', fontSize: 14 }}>{complete.error.message}</Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button onClick={submit} variant="contained" disabled={complete.isPending}>
          Завершить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/kanban/sprint/sprint-complete-dialog.tsx
git commit -m "feat(kanban): sprint complete dialog with destination picker"
```

---

## Task 9: SprintDeleteDialog

**Files:**
- Create: `apps/web/src/components/kanban/sprint/sprint-delete-dialog.tsx`

- [ ] **Step 1: Create the dialog**

Create `apps/web/src/components/kanban/sprint/sprint-delete-dialog.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardTaskData } from '../types'
import { pluralizeRu } from './pluralize-ru'

interface SprintDeleteDialogProps {
  readonly pageId: string
  readonly sprint: { readonly id: string; readonly name: string }
  readonly tasks: BoardTaskData[]
  readonly open: boolean
  readonly onClose: () => void
}

export function SprintDeleteDialog({
  pageId,
  sprint,
  tasks,
  open,
  onClose,
}: SprintDeleteDialogProps) {
  const utils = trpc.useUtils()
  const remove = trpc.kanban.sprint.delete.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      onClose()
    },
  })

  const count = useMemo(
    () => tasks.filter((t) => t.sprintId === sprint.id).length,
    [tasks, sprint.id],
  )

  const word = pluralizeRu(count, ['задача', 'задачи', 'задач'])
  const verb = pluralizeRu(count, ['вернётся', 'вернутся', 'вернутся'])

  function submit() {
    remove.mutate({ pageId, id: sprint.id })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Удалить спринт «{sprint.name}»?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {count > 0
            ? `${count} ${word} ${verb} в беклог.`
            : 'В спринте нет задач.'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Это действие нельзя отменить.
        </Typography>
        {remove.error ? (
          <Box sx={{ mt: 1, color: 'error.main', fontSize: 14 }}>{remove.error.message}</Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          onClick={submit}
          variant="contained"
          color="error"
          disabled={remove.isPending}
        >
          Удалить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/kanban/sprint/sprint-delete-dialog.tsx
git commit -m "feat(kanban): sprint delete confirm dialog"
```

---

## Task 10: SprintMenu

**Files:**
- Create: `apps/web/src/components/kanban/sprint/sprint-menu.tsx`

- [ ] **Step 1: Create the menu component**

Create `apps/web/src/components/kanban/sprint/sprint-menu.tsx`:

```tsx
'use client'

import { useState } from 'react'
import {
  DeleteIcon,
  Divider,
  EditIcon,
  FlagIcon,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  MoreVertIcon,
  PlayArrowIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'
import { SprintCompleteDialog } from './sprint-complete-dialog'
import { SprintDeleteDialog } from './sprint-delete-dialog'
import { SprintEditDialog } from './sprint-edit-dialog'

interface SprintLike {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly description?: string | null
  readonly startDate?: Date | string | null
  readonly endDate?: Date | string | null
}

interface SprintMenuProps {
  readonly pageId: string
  readonly sprint: SprintLike
  readonly allSprints: BoardData['sprints']
  readonly columns: BoardColumnRow[]
  readonly tasks: BoardTaskData[]
}

type OpenDialog = 'edit' | 'complete' | 'delete' | null

export function SprintMenu({ pageId, sprint, allSprints, columns, tasks }: SprintMenuProps) {
  const utils = trpc.useUtils()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [dialog, setDialog] = useState<OpenDialog>(null)

  const activate = trpc.kanban.sprint.activate.useMutation({
    onSuccess: () => utils.kanban.board.getBoard.invalidate({ pageId }),
  })

  function close() {
    setAnchorEl(null)
  }

  function handleStart() {
    close()
    activate.mutate({ pageId, id: sprint.id })
  }

  function openDialog(d: Exclude<OpenDialog, null>) {
    close()
    setDialog(d)
  }

  return (
    <>
      <IconButton
        aria-label="Действия со спринтом"
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
          Действия со спринтом
        </ListSubheader>

        {sprint.status === 'PLANNED' ? (
          <MenuItem onClick={handleStart} disabled={activate.isPending}>
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Стартовать спринт</ListItemText>
          </MenuItem>
        ) : null}

        {sprint.status === 'ACTIVE' ? (
          <MenuItem onClick={() => openDialog('complete')}>
            <ListItemIcon>
              <FlagIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Завершить спринт</ListItemText>
          </MenuItem>
        ) : null}

        <MenuItem onClick={() => openDialog('edit')}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Изменить спринт</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={() => openDialog('delete')} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'error.main' }}>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Удалить спринт</ListItemText>
        </MenuItem>
      </Menu>

      {dialog === 'edit' ? (
        <SprintEditDialog
          pageId={pageId}
          sprint={sprint}
          open
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'complete' ? (
        <SprintCompleteDialog
          pageId={pageId}
          sprint={sprint}
          tasks={tasks}
          columns={columns}
          otherSprints={allSprints}
          open
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'delete' ? (
        <SprintDeleteDialog
          pageId={pageId}
          sprint={sprint}
          tasks={tasks}
          open
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  )
}
```

- [ ] **Step 2: Type-check and lint**

Run in parallel:
- `pnpm --filter web check-types`
- `pnpm --filter web lint`

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/kanban/sprint/sprint-menu.tsx
git commit -m "feat(kanban): sprint three-dot menu with start/complete/edit/delete"
```

---

## Task 11: Refactor SprintSection with new header layout

**Files:**
- Modify: `apps/web/src/components/kanban/views/sprint-section.tsx`
- Modify: `apps/web/src/components/kanban/views/table-view.tsx`

- [ ] **Step 1: Replace sprint-section.tsx**

Open `apps/web/src/components/kanban/views/sprint-section.tsx`. Replace the entire file with:

```tsx
'use client'

import { useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Draggable,
  Droppable,
  type DraggableProvided,
  type DroppableProvided,
} from '@hello-pangea/dnd'
import { format } from 'date-fns'
import { ru as dateFnsRuLocale } from 'date-fns/locale'
import { Box, Chip, Paper, Stack, Typography } from '@repo/ui/components'

import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'
import { AssigneeAvatars } from '../components/assignee-avatars'
import { SprintMenu } from '../sprint/sprint-menu'
import { sprintStatusColor, sprintStatusLabel } from '../sprint/sprint-status-label'

type SprintHeaderProps = {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly description?: string | null
  readonly startDate?: Date | string | null
  readonly endDate?: Date | string | null
}

type SprintSectionProps =
  | {
      readonly kind: 'sprint'
      readonly pageId: string
      readonly sprint: SprintHeaderProps
      readonly allSprints: BoardData['sprints']
      readonly columns: BoardColumnRow[]
      readonly allTasks: BoardTaskData[]
      readonly tasks: BoardTaskData[]
      readonly members: BoardData['members']
      readonly droppableId: string
    }
  | {
      readonly kind: 'backlog'
      readonly tasks: BoardTaskData[]
      readonly members: BoardData['members']
      readonly droppableId: string
    }

interface TaskRowProps {
  readonly task: BoardTaskData
  readonly provided: DraggableProvided
  readonly memberLookup: (userId: string) => { firstName: string | null; email: string } | undefined
  readonly onOpen: (taskId: string) => void
}

function TaskRow({ task, provided, memberLookup, onOpen }: TaskRowProps) {
  return (
    <Stack
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onClick={() => onOpen(task.id)}
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        py: 1,
        px: 1.25,
        borderRadius: 1,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography variant="body2" sx={{ flex: 1 }}>
        {task.title}
      </Typography>
      <AssigneeAvatars assignees={task.assignees} memberLookup={memberLookup} size={22} />
      {task.dueDate ? (
        <Typography variant="caption" color="text.secondary">
          {new Date(task.dueDate).toLocaleDateString('ru-RU')}
        </Typography>
      ) : null}
    </Stack>
  )
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

function formatSprintDates(start: Date | null, end: Date | null): string | null {
  if (!start && !end) return null
  const currentYear = new Date().getFullYear()
  if (start && end) {
    const sameYear = end.getFullYear() === currentYear
    const endPattern = sameYear ? 'd MMM' : 'd MMM yyyy'
    return `${format(start, 'd MMM', { locale: dateFnsRuLocale })} — ${format(end, endPattern, { locale: dateFnsRuLocale })}`
  }
  if (start) return `с ${format(start, 'd MMM', { locale: dateFnsRuLocale })}`
  if (end) return `до ${format(end, 'd MMM', { locale: dateFnsRuLocale })}`
  return null
}

export function SprintSection(props: SprintSectionProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const open = useCallback(
    (taskId: string) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      params.set('taskId', taskId)
      router.replace(`?${params.toString()}`)
    },
    [router, searchParams],
  )
  const memberLookup = useCallback(
    (userId: string) => {
      const m = props.members.find((x) => x.user.id === userId)
      return m ? { firstName: m.user.firstName, email: m.user.email } : undefined
    },
    [props.members],
  )

  const renderDroppable = (provided: DroppableProvided) => (
    <Box ref={provided.innerRef} {...provided.droppableProps} sx={{ minHeight: 32 }}>
      {props.tasks.map((task, index) => (
        <Draggable key={task.id} draggableId={task.id} index={index}>
          {(p) => (
            <TaskRow task={task} provided={p} memberLookup={memberLookup} onOpen={open} />
          )}
        </Draggable>
      ))}
      {provided.placeholder}
    </Box>
  )

  const isActive = props.kind === 'sprint' && props.sprint.status === 'ACTIVE'

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 2,
        p: 1.5,
        borderLeft: isActive ? '3px solid' : undefined,
        borderLeftColor: isActive ? 'primary.main' : undefined,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        {props.kind === 'sprint' ? (
          <>
            <Typography variant="subtitle1" fontWeight={600}>
              {props.sprint.name}
            </Typography>
            {(() => {
              const datesText = formatSprintDates(
                toDate(props.sprint.startDate),
                toDate(props.sprint.endDate),
              )
              return datesText ? (
                <Typography variant="caption" color="text.secondary">
                  {datesText}
                </Typography>
              ) : null
            })()}
            <Chip
              size="small"
              label={sprintStatusLabel(props.sprint.status)}
              color={sprintStatusColor(props.sprint.status)}
              variant={props.sprint.status === 'PLANNED' ? 'outlined' : 'filled'}
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {props.tasks.length}
            </Typography>
            <SprintMenu
              pageId={props.pageId}
              sprint={props.sprint}
              allSprints={props.allSprints}
              columns={props.columns}
              tasks={props.allTasks}
            />
          </>
        ) : (
          <>
            <Typography variant="subtitle1" fontWeight={600}>
              Беклог
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {props.tasks.length}
            </Typography>
          </>
        )}
      </Stack>
      <Droppable droppableId={props.droppableId}>{renderDroppable}</Droppable>
    </Paper>
  )
}
```

- [ ] **Step 2: Update table-view.tsx to pass the new props**

Open `apps/web/src/components/kanban/views/table-view.tsx`. Replace the `<DragDropContext>` block (lines 86-103) with:

```tsx
      <DragDropContext onDragEnd={handleDragEnd}>
        {board.sprints.map((sprint) => {
          const fullSprint = (board as BoardData & {
            sprints: Array<{
              id: string
              name: string
              status: string
              position: number
              description?: string | null
              startDate?: Date | string | null
              endDate?: Date | string | null
            }>
          }).sprints.find((s) => s.id === sprint.id) ?? sprint
          return (
            <SprintSection
              key={sprint.id}
              kind="sprint"
              pageId={pageId}
              sprint={fullSprint}
              allSprints={board.sprints}
              columns={board.columns}
              allTasks={board.tasks}
              tasks={grouped.get(sprint.id) ?? []}
              members={board.members}
              droppableId={`${SPRINT_PREFIX}${sprint.id}`}
            />
          )
        })}
        <SprintSection
          kind="backlog"
          droppableId={BACKLOG_DROPPABLE}
          tasks={grouped.get(null) ?? []}
          members={board.members}
        />
      </DragDropContext>
```

- [ ] **Step 3: Verify `board.sprints` carries dates and description**

Check `apps/web/src/components/kanban/types.ts` line 59. Today it declares:
```ts
sprints: Array<{ id: string; name: string; status: string; position: number }>
```

This omits `description`, `startDate`, `endDate`. The tRPC backend already returns those fields from `board.getBoard` — extend the type:

```ts
sprints: Array<{
  id: string
  name: string
  status: string
  position: number
  description: string | null
  startDate: Date | string | null
  endDate: Date | string | null
}>
```

After updating the type, the cast in step 2 becomes unnecessary — replace the block with:

```tsx
      <DragDropContext onDragEnd={handleDragEnd}>
        {board.sprints.map((sprint) => (
          <SprintSection
            key={sprint.id}
            kind="sprint"
            pageId={pageId}
            sprint={sprint}
            allSprints={board.sprints}
            columns={board.columns}
            allTasks={board.tasks}
            tasks={grouped.get(sprint.id) ?? []}
            members={board.members}
            droppableId={`${SPRINT_PREFIX}${sprint.id}`}
          />
        ))}
        <SprintSection
          kind="backlog"
          droppableId={BACKLOG_DROPPABLE}
          tasks={grouped.get(null) ?? []}
          members={board.members}
        />
      </DragDropContext>
```

- [ ] **Step 4: Type-check and lint**

Run in parallel:
- `pnpm --filter web check-types`
- `pnpm --filter web lint`

Expected: both clean. If `check-types` complains about a consumer of `BoardData['sprints']` that's now wider, fix the consumer (most likely it's `apply-filters.ts` — confirm it still type-checks; the wider type is a superset so it should).

- [ ] **Step 5: Smoke test in dev**

Start: `pnpm --filter web dev` (background ok)
Open: a kanban page with `view=table` in the browser.
Verify:
- Sprint headers show name, dates (if any), Russian status badge, count, three-dot menu.
- ACTIVE sprint has a primary-color left border and tinted header band.
- Backlog has no menu, no badge.
- Three-dot menu opens; items match status (PLANNED → Стартовать; ACTIVE → Завершить; both → Изменить/Удалить).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/kanban/views/sprint-section.tsx apps/web/src/components/kanban/views/table-view.tsx apps/web/src/components/kanban/types.ts
git commit -m "feat(kanban): sprint section header with dates, status badge, accent, menu"
```

---

## Task 12: Default-to-current filter on fresh visits

**Files:**
- Modify: `apps/web/src/components/kanban/use-kanban-filters.ts`
- Modify: `apps/web/src/components/kanban/kanban-board-page.tsx`

- [ ] **Step 1: Update the hook**

Open `apps/web/src/components/kanban/use-kanban-filters.ts`. Add an options arg and use it as a fallback for the sprint filter.

Replace lines 16-43 with:

```ts
interface UseKanbanFiltersOptions {
  readonly defaultSprint?: 'current' | 'all'
}

export function useKanbanFilters(options: UseKanbanFiltersOptions = {}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const defaultSprint = options.defaultSprint ?? 'all'

  const view: KanbanView = useMemo(() => {
    const v = searchParams?.get('view')
    if (v === 'table') return 'table'
    if (v === 'gantt') return 'gantt'
    return 'board'
  }, [searchParams])

  const filters: KanbanFilters = useMemo(() => {
    const sprintParam = searchParams?.get('sprint') ?? null
    let sprint: KanbanFilters['sprint'] = defaultSprint
    if (sprintParam === 'current') sprint = 'current'
    else if (sprintParam === 'all') sprint = 'all'
    else if (sprintParam) sprint = parseCsv(sprintParam)

    return {
      ...EMPTY_FILTERS,
      sprint,
      userIds: parseCsv(searchParams?.get('users') ?? null),
      labelIds: parseCsv(searchParams?.get('labels') ?? null),
      dateFrom: searchParams?.get('from') ?? null,
      dateTo: searchParams?.get('to') ?? null,
      overdueOnly: searchParams?.get('overdue') === '1',
      hideTerminalColumns: view === 'table',
    }
  }, [searchParams, view, defaultSprint])
```

The rest of the file (callbacks and return value) is unchanged.

- [ ] **Step 2: Wire the option in kanban-board-page.tsx**

Open `apps/web/src/components/kanban/kanban-board-page.tsx`. Replace line 24 (`const filtersBag = useKanbanFilters()`) with:

```ts
  const board = data as BoardData | undefined
  const hasActiveSprint = useMemo(
    () => board?.sprints?.some((s) => s.status === 'ACTIVE') ?? false,
    [board?.sprints],
  )
  const filtersBag = useKanbanFilters({
    defaultSprint: hasActiveSprint ? 'current' : 'all',
  })
```

Then **delete** the duplicate `const board = data as BoardData | undefined` on what was line 28 (it now lives above).

- [ ] **Step 3: Type-check and lint**

Run in parallel:
- `pnpm --filter web check-types`
- `pnpm --filter web lint`

Expected: both clean.

- [ ] **Step 4: Smoke test in dev**

In the running dev server, open a kanban page with an ACTIVE sprint (you may need to use the new menu to start one first):
- Open the page with no `?sprint=` param. Expected: only the active sprint's tasks render in the table view; the filter chip shows "Спринт: текущий (...)".
- Click the chip, choose "Все". URL becomes `?sprint=all`; all sprints' tasks render.
- Reload the page. URL still has `?sprint=all`; the all-tasks view persists (explicit URL wins).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/kanban/use-kanban-filters.ts apps/web/src/components/kanban/kanban-board-page.tsx
git commit -m "feat(kanban): default sprint filter to current when active sprint exists"
```

---

## Task 13: E2E sprint lifecycle spec

**Files:**
- Create: `apps/e2e/sprint-lifecycle.spec.ts`

The existing `apps/e2e/kanban-board.spec.ts` defines a `setupKanbanPage(page)` helper that signs up + creates a workspace + creates a kanban page. We mirror that pattern locally (small enough that copying is cleaner than re-exporting). Task data-flow (drag into sprint) is intentionally **not** exercised here — Playwright drag against `@hello-pangea/dnd` is fragile, and the backend tests in Task 1 already cover task-move correctness. This spec covers UI surface only: menu visibility per status, dialog open + submit, header transitions, default filter behavior.

- [ ] **Step 1: Write the e2e spec**

Create `apps/e2e/sprint-lifecycle.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupKanbanPage(page: Page) {
  const email = `sprint+${Date.now()}+${Math.random().toString(36).slice(2, 8)}@example.com`

  await signUpAndAuthAs(page, { email, password, firstName: 'Спринт', lastName: 'Тестер' })

  await page.getByRole('textbox', { name: 'Название' }).fill('Sprint WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  const pagesHeaderRow = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//button][1]')
  await pagesHeaderRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Канбан' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })

  // Switch to table view where sprints live
  await expect(page.getByRole('button', { name: 'Таблица' })).toBeVisible()
  await page.getByRole('button', { name: 'Таблица' }).click()
  await expect(page.getByText('Беклог', { exact: true })).toBeVisible()
}

function sprintSection(page: Page, name: string) {
  return page.getByText(name, { exact: true }).locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]')
}

async function createSprint(page: Page, name: string) {
  await page.getByRole('button', { name: 'Новый спринт' }).click()
  await page.getByRole('dialog').getByLabel('Название').fill(name)
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(sprintSection(page, name)).toBeVisible()
}

async function openSprintMenu(page: Page, sprintName: string) {
  await sprintSection(page, sprintName)
    .getByRole('button', { name: 'Действия со спринтом' })
    .click()
}

test('sprint lifecycle: start, edit, complete, delete with status transitions', async ({ page }) => {
  await setupKanbanPage(page)

  // Create two sprints
  await createSprint(page, 'Sprint A')
  await createSprint(page, 'Sprint B')

  // Both start as PLANNED → badge "Планирование", menu shows "Стартовать"
  await expect(sprintSection(page, 'Sprint A').getByText('Планирование')).toBeVisible()
  await expect(sprintSection(page, 'Sprint B').getByText('Планирование')).toBeVisible()

  // Start Sprint A
  await openSprintMenu(page, 'Sprint A')
  await page.getByRole('menuitem', { name: 'Стартовать спринт' }).click()
  await expect(sprintSection(page, 'Sprint A').getByText('Активный')).toBeVisible()
  await expect(sprintSection(page, 'Sprint B').getByText('Планирование')).toBeVisible()

  // Menu on ACTIVE sprint hides "Стартовать" and shows "Завершить"
  await openSprintMenu(page, 'Sprint A')
  await expect(page.getByRole('menuitem', { name: 'Стартовать спринт' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Завершить спринт' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Edit Sprint A's name
  await openSprintMenu(page, 'Sprint A')
  await page.getByRole('menuitem', { name: 'Изменить спринт' }).click()
  const editDialog = page.getByRole('dialog')
  await editDialog.getByLabel('Название').fill('Sprint A renamed')
  await editDialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sprintSection(page, 'Sprint A renamed')).toBeVisible()

  // Complete Sprint A renamed (no tasks, but the dialog still works)
  await openSprintMenu(page, 'Sprint A renamed')
  await page.getByRole('menuitem', { name: 'Завершить спринт' }).click()
  const completeDialog = page.getByRole('dialog')
  await expect(completeDialog.getByText('Выполнено')).toBeVisible()
  await expect(completeDialog.getByText('Не выполнено')).toBeVisible()
  await completeDialog.getByRole('button', { name: 'Завершить' }).click()
  await expect(sprintSection(page, 'Sprint A renamed').getByText('Завершён')).toBeVisible()

  // Delete Sprint B
  await openSprintMenu(page, 'Sprint B')
  await page.getByRole('menuitem', { name: 'Удалить спринт' }).click()
  const deleteDialog = page.getByRole('dialog')
  await expect(deleteDialog.getByText(/нет задач|вернётся в беклог|вернутся в беклог/)).toBeVisible()
  await deleteDialog.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Sprint B', { exact: true })).toHaveCount(0)
})
```

- [ ] **Step 2: Run the spec**

Run: `pnpm exec playwright test apps/e2e/sprint-lifecycle.spec.ts`

Expected: pass. If a locator misses (typically because the dialog title doesn't match the role-derived label), inspect with `pnpm exec playwright test apps/e2e/sprint-lifecycle.spec.ts --headed --debug` and adjust the locator — do not weaken assertions.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/sprint-lifecycle.spec.ts
git commit -m "test(e2e): sprint lifecycle (start, edit, complete, delete) in table view"
```

---

## Task 14: Full gates and final verification

**Files:** (none — verification only)

- [ ] **Step 1: Run the full gates suite**

Run: `pnpm gates`

Expected: green across `check-types`, `lint`, `build`, `test`. If anything fails, fix it before proceeding. Do not skip hooks.

- [ ] **Step 2: Smoke test in dev**

If not already running: `pnpm --filter web dev`

In a browser, on a kanban page with `?view=table`:
- Create three planned sprints; verify each shows `Планирование` badge.
- Start sprint 1 via the menu; verify badge flips to `Активный`, left border appears, header band tints.
- Reload with no `?sprint=` param; verify only sprint 1's tasks show.
- Open three-dot menu on sprint 1; verify `Завершить спринт` is visible and `Стартовать спринт` is hidden.
- Open three-dot menu on sprint 2; verify the reverse.
- Edit sprint 2: change name, save; verify header updates.
- Complete sprint 1: pick sprint 2 as destination; verify undone tasks moved, sprint 1 shows `Завершён`.
- Delete sprint 2: verify confirm shows task count; confirm; verify tasks land in Беклог.

- [ ] **Step 3: No commit needed; gates pass closes the work**

The previous task already committed the e2e spec — the work is complete when `pnpm gates` is green and the smoke checks pass.

---

## Notes for the executing engineer

- **DRY**: `pluralizeRu` and `sprintStatusLabel` live in their own files so future sprint-adjacent surfaces (gantt, board view) can import them without dragging in the dialog code.
- **YAGNI**: do not introduce a toast layer; dialog-local inline error text is the agreed pattern. Do not introduce an i18n framework.
- **TDD**: tasks 1, 3, 4 follow strict test-first. Tasks 6-12 are UI/refactor work where the verification layer is type-check, lint, and the Task-13 e2e spec. Do not skip the e2e.
- **Frequent commits**: every task ends with a commit. Do not batch.
- **Filter compatibility**: the `apply-filters.ts` already handles the `sprint === 'current'` branch (verified in spec). The default-to-current change in Task 12 is purely upstream of that code — no apply-filters changes needed.
- **Realtime**: `kanbanBus.emit('sprint.upserted', ...)` triggers SSE listeners that invalidate `getBoard`. The complete mutation emits twice (source + destination) so both sections refresh.
- **If `pnpm gates` fails on `format`**: run `pnpm format` and commit the formatting separately (`style(kanban): prettier`).
