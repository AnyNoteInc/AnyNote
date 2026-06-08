'use client'

import { useMemo, useState } from 'react'
import {
  AddIcon,
  Box,
  Button,
  FilterListIcon,
  InputBase,
  Menu,
  MenuItem,
  Popover,
  SearchIcon,
  Stack,
  SwapVertIcon,
  TuneIcon,
} from '@repo/ui/components'
import type { DatabasePropertyType } from '@repo/db'

import { trpc } from '@/trpc/client'

import { parseViewSettings } from './types'
import type { DatabaseSchema, DatabaseViewEntry } from './types'
import { DatabaseFilterBuilder } from './view-config/database-filter-builder'
import { DatabaseSortBuilder } from './view-config/database-sort-builder'
import { PropertyVisibilityPanel } from './view-config/property-visibility-panel'

interface DatabaseToolbarProps {
  readonly pageId: string
  readonly view: DatabaseViewEntry
  readonly properties: DatabaseSchema['properties']
  readonly systemTitleProperty: DatabaseSchema['systemTitleProperty']
  readonly search: string
  readonly onSearchChange: (value: string) => void
  readonly editable?: boolean
}

// MVP property types the "+ Свойство" menu can create. PERSON/FILE are in the
// enum but have no editor yet, so they are omitted from creation here.
const CREATABLE_PROPERTY_TYPES: ReadonlyArray<{ type: DatabasePropertyType; label: string }> = [
  { type: 'TEXT', label: 'Текст' },
  { type: 'NUMBER', label: 'Число' },
  { type: 'STATUS', label: 'Статус' },
  { type: 'SELECT', label: 'Выбор' },
  { type: 'CHECKBOX', label: 'Флажок' },
  { type: 'DATE', label: 'Дата' },
]

const PROPERTY_TYPE_DEFAULT_NAME: Partial<Record<DatabasePropertyType, string>> = {
  TEXT: 'Текст',
  NUMBER: 'Число',
  STATUS: 'Статус',
  SELECT: 'Выбор',
  CHECKBOX: 'Флажок',
  DATE: 'Дата',
}

type ConfigPanel = 'filter' | 'sort' | 'visibility'

export function DatabaseToolbar({
  pageId,
  view,
  properties,
  systemTitleProperty,
  search,
  onSearchChange,
  editable = true,
}: DatabaseToolbarProps) {
  const utils = trpc.useUtils()
  const [propAnchorEl, setPropAnchorEl] = useState<HTMLElement | null>(null)
  const [configAnchorEl, setConfigAnchorEl] = useState<HTMLElement | null>(null)
  const [configPanel, setConfigPanel] = useState<ConfigPanel | null>(null)

  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])
  const activeFilterCount = settings.filters?.conditions.length ?? 0
  const activeSortCount = settings.sorts?.length ?? 0

  // createRow touches the rows (listRows); createProperty touches the schema
  // (getByPage). Invalidate both so either surface refreshes.
  const invalidate = async () => {
    await Promise.all([
      utils.database.getByPage.invalidate({ pageId }),
      utils.database.listRows.invalidate({ pageId }),
    ])
  }
  const createRow = trpc.database.createRow.useMutation({ onSuccess: invalidate })
  const createProperty = trpc.database.createProperty.useMutation({ onSuccess: invalidate })

  function addProperty(type: DatabasePropertyType) {
    setPropAnchorEl(null)
    const name = PROPERTY_TYPE_DEFAULT_NAME[type] ?? 'Свойство'
    // Seed default options for choice-based types so the cell editor is usable.
    const optionSettings =
      type === 'SELECT' || type === 'STATUS'
        ? {
            options: [
              { id: 'opt-1', label: 'Вариант 1', color: '#9CA3AF' },
              { id: 'opt-2', label: 'Вариант 2', color: '#3B82F6' },
            ],
          }
        : undefined
    createProperty.mutate({ pageId, type, name, ...(optionSettings ? { settings: optionSettings } : {}) })
  }

  function openConfig(panel: ConfigPanel, anchor: HTMLElement) {
    setConfigPanel(panel)
    setConfigAnchorEl(anchor)
  }

  function closeConfig() {
    setConfigAnchorEl(null)
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          borderRadius: 1,
          bgcolor: 'action.hover',
          maxWidth: 220,
          flex: '0 1 220px',
        }}
      >
        <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <InputBase
          value={search}
          placeholder="Поиск в базе"
          onChange={(e) => onSearchChange(e.target.value)}
          sx={{ fontSize: 14, flex: 1 }}
        />
      </Box>

      {editable ? (
        <>
          <Button
            size="small"
            color={activeFilterCount > 0 ? 'primary' : 'inherit'}
            startIcon={<FilterListIcon />}
            onClick={(e) => openConfig('filter', e.currentTarget)}
          >
            Фильтр{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
          <Button
            size="small"
            color={activeSortCount > 0 ? 'primary' : 'inherit'}
            startIcon={<SwapVertIcon />}
            onClick={(e) => openConfig('sort', e.currentTarget)}
          >
            Сортировка{activeSortCount > 0 ? ` (${activeSortCount})` : ''}
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<TuneIcon />}
            onClick={(e) => openConfig('visibility', e.currentTarget)}
          >
            Свойства
          </Button>
        </>
      ) : null}

      <Box sx={{ flex: 1 }} />

      {editable ? (
        <>
          <Button
            size="small"
            startIcon={<AddIcon />}
            disabled={createRow.isPending}
            onClick={() => createRow.mutate({ pageId })}
          >
            Строка
          </Button>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={(e) => setPropAnchorEl(e.currentTarget)}
          >
            Свойство
          </Button>
          <Menu
            anchorEl={propAnchorEl}
            open={Boolean(propAnchorEl)}
            onClose={() => setPropAnchorEl(null)}
          >
            {CREATABLE_PROPERTY_TYPES.map((entry) => (
              <MenuItem key={entry.type} onClick={() => addProperty(entry.type)}>
                {entry.label}
              </MenuItem>
            ))}
          </Menu>

          <Popover
            open={Boolean(configAnchorEl)}
            anchorEl={configAnchorEl}
            onClose={closeConfig}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            {configPanel === 'filter' ? (
              <DatabaseFilterBuilder
                pageId={pageId}
                view={view}
                properties={properties}
                systemTitleProperty={systemTitleProperty}
              />
            ) : null}
            {configPanel === 'sort' ? (
              <DatabaseSortBuilder
                pageId={pageId}
                view={view}
                properties={properties}
                systemTitleProperty={systemTitleProperty}
              />
            ) : null}
            {configPanel === 'visibility' ? (
              <PropertyVisibilityPanel
                pageId={pageId}
                view={view}
                properties={properties}
                systemTitleProperty={systemTitleProperty}
              />
            ) : null}
          </Popover>
        </>
      ) : null}
    </Stack>
  )
}
