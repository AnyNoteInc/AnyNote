'use client'

import { Button, ButtonGroup } from '@repo/ui/components'

import type { KanbanView } from './use-kanban-filters'

interface ViewSwitcherProps {
  readonly view: KanbanView
  readonly onChange: (next: KanbanView) => void
}

const VIEWS: Array<{ value: KanbanView; label: string }> = [
  { value: 'board', label: 'Доска' },
  { value: 'table', label: 'Таблица' },
  { value: 'gantt', label: 'Гант' },
]

export function ViewSwitcher({ view, onChange }: ViewSwitcherProps) {
  return (
    <ButtonGroup size="small">
      {VIEWS.map((v) => (
        <Button
          key={v.value}
          variant={view === v.value ? 'contained' : 'outlined'}
          onClick={() => onChange(v.value)}
        >
          {v.label}
        </Button>
      ))}
    </ButtonGroup>
  )
}
