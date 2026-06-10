'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import {
  AccountTreeIcon,
  AddIcon,
  AttachFileIcon,
  Box,
  Button,
  CalculateIcon,
  CalendarTodayIcon,
  CheckBoxIcon,
  Divider,
  EmailIcon,
  FileDownloadIcon,
  FilterListIcon,
  IconButton,
  InputBase,
  LabelIcon,
  LinkIcon,
  ListItemIcon,
  ListItemText,
  LocalPhoneIcon,
  Menu,
  MenuItem,
  NumbersIcon,
  PersonIcon,
  Popover,
  SearchIcon,
  SecurityIcon,
  Stack,
  SwapVertIcon,
  TextFieldsIcon,
  TocIcon,
  Tooltip,
  TuneIcon,
  Typography,
  UpdateIcon,
} from '@repo/ui/components'
import type { DatabasePropertyType } from '@repo/db'

import { trpc } from '@/trpc/client'

import { parseViewSettings, structureDisabledReason } from './types'
import type { DatabaseSchema, DatabaseViewEntry, MyDatabaseAccess } from './types'
import { DatabaseFilterBuilder } from './view-config/database-filter-builder'
import { DatabaseSortBuilder } from './view-config/database-sort-builder'
import { PropertyVisibilityPanel } from './view-config/property-visibility-panel'
import { PropertySettingsDialog } from './property-config/property-settings-dialog'
import type { SettingsDialogProperty } from './property-config/property-settings-dialog'
import { DatabaseAccessDialog } from './access/database-access-dialog'

interface DatabaseToolbarProps {
  readonly pageId: string
  readonly view: DatabaseViewEntry
  readonly properties: DatabaseSchema['properties']
  readonly systemTitleProperty: DatabaseSchema['systemTitleProperty']
  readonly search: string
  readonly onSearchChange: (value: string) => void
  /** Content rights — gates the "+ Строка" (row create) button. */
  readonly editable?: boolean
  /** Structure rights — gates filter/sort/visibility, "+ Свойство", access panel. */
  readonly canEditStructure?: boolean
  readonly myAccess: MyDatabaseAccess
}

interface PropertyTypeEntry {
  readonly type: DatabasePropertyType
  readonly label: string
  readonly icon: ReactNode
}

// The user-creatable property types in the "+ Свойство" menu (with Russian labels +
// icons). FORMULA/RELATION/ROLLUP are created with empty settings and immediately
// open the settings dialog so the user configures them. The readonly metadata types
// live in a separate "Системные" subsection below.
const CREATABLE_PROPERTY_TYPES: ReadonlyArray<PropertyTypeEntry> = [
  { type: 'TEXT', label: 'Текст', icon: <TextFieldsIcon fontSize="small" /> },
  { type: 'NUMBER', label: 'Число', icon: <NumbersIcon fontSize="small" /> },
  { type: 'STATUS', label: 'Статус', icon: <LabelIcon fontSize="small" /> },
  { type: 'SELECT', label: 'Выбор', icon: <LabelIcon fontSize="small" /> },
  { type: 'MULTI_SELECT', label: 'Мультивыбор', icon: <LabelIcon fontSize="small" /> },
  { type: 'CHECKBOX', label: 'Флажок', icon: <CheckBoxIcon fontSize="small" /> },
  { type: 'DATE', label: 'Дата', icon: <CalendarTodayIcon fontSize="small" /> },
  { type: 'PERSON', label: 'Участник', icon: <PersonIcon fontSize="small" /> },
  { type: 'FILE', label: 'Файл', icon: <AttachFileIcon fontSize="small" /> },
  { type: 'URL', label: 'Ссылка', icon: <LinkIcon fontSize="small" /> },
  { type: 'EMAIL', label: 'Email', icon: <EmailIcon fontSize="small" /> },
  { type: 'PHONE', label: 'Телефон', icon: <LocalPhoneIcon fontSize="small" /> },
  { type: 'PAGE_LINK', label: 'Ссылка на страницу', icon: <TocIcon fontSize="small" /> },
  { type: 'FORMULA', label: 'Формула', icon: <CalculateIcon fontSize="small" /> },
  { type: 'RELATION', label: 'Связь', icon: <AccountTreeIcon fontSize="small" /> },
  { type: 'ROLLUP', label: 'Сводка', icon: <FilterListIcon fontSize="small" /> },
]

// Read-only metadata types: derived from the item Page, never user-edited. Grouped
// in a "Системные" subsection of the menu.
const SYSTEM_PROPERTY_TYPES: ReadonlyArray<PropertyTypeEntry> = [
  { type: 'CREATED_TIME', label: 'Время создания', icon: <CalendarTodayIcon fontSize="small" /> },
  { type: 'CREATED_BY', label: 'Создатель', icon: <PersonIcon fontSize="small" /> },
  { type: 'LAST_EDITED_TIME', label: 'Время изменения', icon: <UpdateIcon fontSize="small" /> },
  { type: 'LAST_EDITED_BY', label: 'Кем изменено', icon: <PersonIcon fontSize="small" /> },
]

const PROPERTY_TYPE_DEFAULT_NAME: Partial<Record<DatabasePropertyType, string>> = {
  TEXT: 'Текст',
  NUMBER: 'Число',
  STATUS: 'Статус',
  SELECT: 'Выбор',
  MULTI_SELECT: 'Мультивыбор',
  CHECKBOX: 'Флажок',
  DATE: 'Дата',
  PERSON: 'Участник',
  FILE: 'Файл',
  URL: 'Ссылка',
  EMAIL: 'Email',
  PHONE: 'Телефон',
  PAGE_LINK: 'Ссылка на страницу',
  FORMULA: 'Формула',
  RELATION: 'Связь',
  ROLLUP: 'Сводка',
  CREATED_TIME: 'Время создания',
  CREATED_BY: 'Создатель',
  LAST_EDITED_TIME: 'Время изменения',
  LAST_EDITED_BY: 'Кем изменено',
}

// FORMULA/RELATION/ROLLUP need configuration before they render meaningfully, so we
// open the settings dialog right after creating one.
const CONFIGURABLE_ON_CREATE: ReadonlySet<DatabasePropertyType> = new Set<DatabasePropertyType>([
  'FORMULA',
  'RELATION',
  'ROLLUP',
])

type ConfigPanel = 'filter' | 'sort' | 'visibility'

export function DatabaseToolbar({
  pageId,
  view,
  properties,
  systemTitleProperty,
  search,
  onSearchChange,
  editable = true,
  canEditStructure = true,
  myAccess,
}: DatabaseToolbarProps) {
  const utils = trpc.useUtils()
  const [propAnchorEl, setPropAnchorEl] = useState<HTMLElement | null>(null)
  const [configAnchorEl, setConfigAnchorEl] = useState<HTMLElement | null>(null)
  const [configPanel, setConfigPanel] = useState<ConfigPanel | null>(null)
  const [accessOpen, setAccessOpen] = useState(false)
  // After creating a FORMULA/RELATION/ROLLUP property we open the settings dialog
  // for the freshly created property so the user configures it immediately.
  const [settingsProperty, setSettingsProperty] = useState<SettingsDialogProperty | null>(null)

  // Structure affordances disable when the viewer lacks structure rights or the
  // source's structure is locked; the tooltip distinguishes the two. They are still
  // RENDERED (disabled) whenever the page is editable at all, so the user sees why
  // they can't act; a pure read-only viewer sees nothing.
  const structureReason = structureDisabledReason(myAccess)
  const showStructureControls = editable || canEditStructure

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
  const createProperty = trpc.database.createProperty.useMutation({
    onSuccess: async (created) => {
      await invalidate()
      // FORMULA/RELATION/ROLLUP need configuration to render — open the dialog for
      // the freshly created property (it carries empty settings until configured).
      if (CONFIGURABLE_ON_CREATE.has(created.type)) {
        setSettingsProperty(created)
      }
    },
  })

  function addProperty(type: DatabasePropertyType) {
    setPropAnchorEl(null)
    const name = PROPERTY_TYPE_DEFAULT_NAME[type] ?? 'Свойство'
    // Seed default options for choice-based types so the cell editor is usable.
    const seedsOptions = type === 'SELECT' || type === 'STATUS' || type === 'MULTI_SELECT'
    const optionSettings = seedsOptions
      ? {
          options: [
            { id: 'opt-1', label: 'Вариант 1', color: '#9CA3AF' },
            { id: 'opt-2', label: 'Вариант 2', color: '#3B82F6' },
          ],
        }
      : undefined
    createProperty.mutate({
      pageId,
      type,
      name,
      ...(optionSettings ? { settings: optionSettings } : {}),
    })
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

      {showStructureControls ? (
        <Tooltip
          title={canEditStructure ? '' : structureReason}
          disableHoverListener={canEditStructure}
        >
          <Box component="span" sx={{ display: 'inline-flex', gap: 0.5 }}>
            <Button
              size="small"
              color={activeFilterCount > 0 ? 'primary' : 'inherit'}
              startIcon={<FilterListIcon />}
              disabled={!canEditStructure}
              onClick={(e) => openConfig('filter', e.currentTarget)}
            >
              Фильтр{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Button>
            <Button
              size="small"
              color={activeSortCount > 0 ? 'primary' : 'inherit'}
              startIcon={<SwapVertIcon />}
              disabled={!canEditStructure}
              onClick={(e) => openConfig('sort', e.currentTarget)}
            >
              Сортировка{activeSortCount > 0 ? ` (${activeSortCount})` : ''}
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<TuneIcon />}
              disabled={!canEditStructure}
              onClick={(e) => openConfig('visibility', e.currentTarget)}
            >
              Свойства
            </Button>
          </Box>
        </Tooltip>
      ) : null}

      <Box sx={{ flex: 1 }} />

      {/* Read-only data portability: deliberately NOT gated by editable/canEditStructure. */}
      <Button
        size="small"
        color="inherit"
        component="a"
        href={`/api/pages/${pageId}/export/csv?viewId=${view.id}`}
        startIcon={<FileDownloadIcon />}
        data-testid="export-csv"
      >
        Экспорт CSV
      </Button>

      {editable ? (
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={createRow.isPending}
          onClick={() => createRow.mutate({ pageId })}
        >
          Строка
        </Button>
      ) : null}

      {showStructureControls ? (
        <>
          <Tooltip
            title={canEditStructure ? '' : structureReason}
            disableHoverListener={canEditStructure}
          >
            <Box component="span">
              <Button
                size="small"
                startIcon={<AddIcon />}
                disabled={!canEditStructure}
                onClick={(e) => setPropAnchorEl(e.currentTarget)}
              >
                Свойство
              </Button>
            </Box>
          </Tooltip>
          {myAccess.canEditStructure ? (
            <Tooltip title="Доступ и права">
              <IconButton
                size="small"
                aria-label="Доступ и права"
                onClick={() => setAccessOpen(true)}
              >
                <SecurityIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          <Menu
            anchorEl={propAnchorEl}
            open={Boolean(propAnchorEl)}
            onClose={() => setPropAnchorEl(null)}
            slotProps={{ paper: { sx: { maxHeight: 420 } } }}
          >
            {CREATABLE_PROPERTY_TYPES.map((entry) => (
              <MenuItem key={entry.type} onClick={() => addProperty(entry.type)} dense>
                <ListItemIcon>{entry.icon}</ListItemIcon>
                <ListItemText primary={entry.label} />
              </MenuItem>
            ))}
            <Divider />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ px: 2, py: 0.5, display: 'block' }}
            >
              Системные
            </Typography>
            {SYSTEM_PROPERTY_TYPES.map((entry) => (
              <MenuItem key={entry.type} onClick={() => addProperty(entry.type)} dense>
                <ListItemIcon>{entry.icon}</ListItemIcon>
                <ListItemText primary={entry.label} />
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

          {settingsProperty ? (
            <PropertySettingsDialog
              pageId={pageId}
              property={settingsProperty}
              open
              onClose={() => setSettingsProperty(null)}
            />
          ) : null}

          {myAccess.canEditStructure ? (
            <DatabaseAccessDialog
              pageId={pageId}
              properties={properties}
              myAccess={myAccess}
              open={accessOpen}
              onClose={() => setAccessOpen(false)}
            />
          ) : null}
        </>
      ) : null}
    </Stack>
  )
}
