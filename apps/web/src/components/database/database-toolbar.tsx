'use client'

import { useState } from 'react'
import {
  AddIcon,
  Box,
  Button,
  Chip,
  InputBase,
  Menu,
  MenuItem,
  SearchIcon,
  Stack,
  TableChartIcon,
} from '@repo/ui/components'
import type { DatabasePropertyType } from '@repo/db'

import { trpc } from '@/trpc/client'

interface DatabaseToolbarProps {
  readonly pageId: string
  readonly viewTitle: string
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

export function DatabaseToolbar({
  pageId,
  viewTitle,
  search,
  onSearchChange,
  editable = true,
}: DatabaseToolbarProps) {
  const utils = trpc.useUtils()
  const [propAnchorEl, setPropAnchorEl] = useState<HTMLElement | null>(null)

  // createRow touches the rows (listRows); createProperty touches the schema
  // (getByPage). Invalidate both so the merged view-model refetches either way.
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
    const settings =
      type === 'SELECT' || type === 'STATUS'
        ? {
            options: [
              { id: 'opt-1', label: 'Вариант 1', color: '#9CA3AF' },
              { id: 'opt-2', label: 'Вариант 2', color: '#3B82F6' },
            ],
          }
        : undefined
    createProperty.mutate({ pageId, type, name, ...(settings ? { settings } : {}) })
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      {/* View selector placeholder — multiple views land in cl4. */}
      <Chip icon={<TableChartIcon />} label={viewTitle} size="small" variant="outlined" />

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
        </>
      ) : null}
    </Stack>
  )
}
