'use client'

import { useState } from 'react'
import {
  AccountTreeIcon,
  Button,
  ButtonGroup,
  IconButton,
  SettingsIcon,
  Stack,
  TableChartIcon,
  Tooltip,
  ViewKanbanIcon,
} from '@repo/ui/components'

import type { BoardData } from './types'
import type { KanbanView, useKanbanFilters } from './use-kanban-filters'
import { KanbanFiltersUI } from './kanban-filters'
import { KanbanSettingsDialog } from './settings/kanban-settings-dialog'

type FiltersBag = ReturnType<typeof useKanbanFilters>

interface KanbanToolbarProps {
  readonly pageId: string
  readonly filtersBag: FiltersBag
  readonly board: BoardData
}

const VIEWS: ReadonlyArray<{ value: KanbanView; tooltip: string; Icon: typeof ViewKanbanIcon }> = [
  { value: 'board', tooltip: 'Доска', Icon: ViewKanbanIcon },
  { value: 'table', tooltip: 'Таблица', Icon: TableChartIcon },
  { value: 'gantt', tooltip: 'Гант', Icon: AccountTreeIcon },
]

export function KanbanToolbar({ pageId, filtersBag, board }: KanbanToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={2}
      sx={{ px: 4, py: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, flexWrap: 'wrap' }}>
        <KanbanFiltersUI board={board} bag={filtersBag} />
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <ButtonGroup size="small" variant="outlined">
          {VIEWS.map(({ value, tooltip, Icon }) => {
            const active = filtersBag.view === value
            return (
              <Tooltip key={value} title={tooltip} arrow>
                <Button
                  variant={active ? 'contained' : 'outlined'}
                  onClick={() => filtersBag.setView(value)}
                  aria-label={tooltip}
                  aria-pressed={active}
                  sx={{ minWidth: 36, px: 1 }}
                >
                  <Icon fontSize="small" />
                </Button>
              </Tooltip>
            )
          })}
        </ButtonGroup>
        <Tooltip title="Настройки канбана" arrow>
          <IconButton
            onClick={() => setSettingsOpen(true)}
            size="small"
            aria-label="Настройки канбана"
          >
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <KanbanSettingsDialog
        pageId={pageId}
        board={board}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </Stack>
  )
}
