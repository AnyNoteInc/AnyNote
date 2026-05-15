'use client'

import { Button, Stack } from '@repo/ui/components'

import type { KanbanView } from './use-kanban-filters'

interface ViewSwitcherProps {
  view: KanbanView
  onChange: (next: KanbanView) => void
}

export function ViewSwitcher({ view, onChange }: ViewSwitcherProps) {
  return (
    <Stack direction="row" spacing={0.5}>
      <Button
        size="small"
        variant={view === 'board' ? 'contained' : 'outlined'}
        onClick={() => onChange('board')}
      >
        Доска
      </Button>
      <Button
        size="small"
        variant={view === 'table' ? 'contained' : 'outlined'}
        onClick={() => onChange('table')}
      >
        Таблица
      </Button>
    </Stack>
  )
}
