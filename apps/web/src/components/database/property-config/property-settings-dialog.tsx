'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@repo/ui/components'
import type { DatabasePropertyType } from '@repo/db'

import { trpc } from '@/trpc/client'

import type { SelectOption } from '../types'
import { useDatabaseWorkspaceId } from '../cell-editors/use-optimistic-cell'
import { NumberFormatPicker } from './number-format-picker'
import type { NumberFormat } from './number-format-picker'
import { OptionsEditor } from './options-editor'
import { FormulaEditor } from './formula-editor'
import { RelationConfig } from './relation-config'
import type { RelationSettings } from './relation-config'
import { RollupConfig } from './rollup-config'
import type { RollupSettings } from './rollup-config'

// Client-side mirror of the dto `PropertySettings` (type-only — the dto runtime
// drags the @repo/db/pg adapter into the client bundle).
interface PropertySettings {
  options?: SelectOption[]
  numberFormat?: NumberFormat
  formula?: string
  relation?: RelationSettings
  rollup?: RollupSettings
}

/**
 * The minimum property shape the dialog needs. Both `DatabasePropertyView` (from
 * `getByPage`) and the `createProperty` mutation result (whose `settings` is a raw
 * `unknown` JSON value) structurally satisfy this — so the header cell and the
 * toolbar's create-then-configure flow can both pass their property without a cast.
 */
export interface SettingsDialogProperty {
  readonly id: string
  readonly type: DatabasePropertyType
  readonly name: string
  readonly settings?: unknown
}

interface PropertySettingsDialogProps {
  readonly pageId: string
  readonly property: SettingsDialogProperty
  readonly open: boolean
  readonly onClose: () => void
}

// Types whose settings section is rendered. Selecting an unlisted type just renames
// + retypes the property (its cells re-render via the new editor). Russian labels
// match the creatable-type menu.
const TYPE_LABELS: ReadonlyArray<{ type: DatabasePropertyType; label: string }> = [
  { type: 'TEXT', label: 'Текст' },
  { type: 'NUMBER', label: 'Число' },
  { type: 'STATUS', label: 'Статус' },
  { type: 'SELECT', label: 'Выбор' },
  { type: 'MULTI_SELECT', label: 'Мультивыбор' },
  { type: 'CHECKBOX', label: 'Флажок' },
  { type: 'DATE', label: 'Дата' },
  { type: 'PERSON', label: 'Участник' },
  { type: 'FILE', label: 'Файл' },
  { type: 'URL', label: 'Ссылка' },
  { type: 'EMAIL', label: 'Email' },
  { type: 'PHONE', label: 'Телефон' },
  { type: 'PAGE_LINK', label: 'Ссылка на страницу' },
  { type: 'FORMULA', label: 'Формула' },
  { type: 'RELATION', label: 'Связь' },
  { type: 'ROLLUP', label: 'Сводка' },
]

const OPTION_TYPES: ReadonlySet<DatabasePropertyType> = new Set<DatabasePropertyType>([
  'SELECT',
  'STATUS',
  'MULTI_SELECT',
])

function settingsOf(property: SettingsDialogProperty): PropertySettings {
  const s = property.settings
  return s && typeof s === 'object' ? (s as PropertySettings) : {}
}

/**
 * Configure a database property: rename, change type (with a warning that
 * incompatible cells may clear), and edit the type-specific settings (options +
 * colours, number format, formula, relation target, rollup). Loads the database
 * schema to resolve this property's source + sibling properties (the rollup needs
 * them). Persists name/type/settings in one `updateProperty` call on save.
 */
export function PropertySettingsDialog({
  pageId,
  property,
  open,
  onClose,
}: PropertySettingsDialogProps) {
  const utils = trpc.useUtils()
  const workspaceId = useDatabaseWorkspaceId()

  const [name, setName] = useState(property.name)
  const [type, setType] = useState<DatabasePropertyType>(property.type)
  const [settings, setSettings] = useState<PropertySettings>(() => settingsOf(property))

  // Reset the draft whenever the dialog (re)opens for a (possibly different) property.
  useEffect(() => {
    if (open) {
      setName(property.name)
      setType(property.type)
      setSettings(settingsOf(property))
    }
  }, [open, property])

  // The schema gives us this property's source id (for relation self-exclusion) and
  // the sibling properties (for the rollup relation-property picker).
  const schema = trpc.database.getByPage.useQuery({ pageId }, { enabled: open, retry: false })
  const siblingProperties = useMemo(() => schema.data?.properties ?? [], [schema.data])
  const selfSourceId = schema.data?.source.id

  const invalidate = async () => {
    await Promise.all([
      utils.database.getByPage.invalidate({ pageId }),
      utils.database.listRows.invalidate(),
      utils.database.listGroupedRows.invalidate(),
    ])
  }
  const updateProperty = trpc.database.updateProperty.useMutation({
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })

  function patchSettings(patch: Partial<PropertySettings>) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  const typeChanged = type !== property.type

  function save() {
    const trimmed = name.trim() || property.name
    updateProperty.mutate({ pageId, id: property.id, name: trimmed, type, settings })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Настройка свойства</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <TextField
            label="Название"
            size="small"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'Название свойства' } }}
          />

          <FormControl size="small" fullWidth>
            <InputLabel id="property-type-label">Тип</InputLabel>
            <Select
              labelId="property-type-label"
              label="Тип"
              value={type}
              onChange={(e) => setType(e.target.value as DatabasePropertyType)}
            >
              {TYPE_LABELS.map((t) => (
                <MenuItem key={t.type} value={t.type}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {typeChanged ? (
            <Alert severity="warning" variant="outlined">
              Смена типа может очистить значения ячеек, несовместимые с новым типом.
            </Alert>
          ) : null}

          {OPTION_TYPES.has(type) ? (
            <OptionsEditor
              options={settings.options ?? []}
              onChange={(options) => patchSettings({ options })}
            />
          ) : null}

          {type === 'NUMBER' ? (
            <NumberFormatPicker
              value={settings.numberFormat}
              onChange={(numberFormat) => patchSettings({ numberFormat })}
            />
          ) : null}

          {type === 'FORMULA' ? (
            <FormulaEditor
              value={settings.formula ?? ''}
              onChange={(formula) => patchSettings({ formula })}
            />
          ) : null}

          {type === 'RELATION' ? (
            <RelationConfig
              workspaceId={workspaceId}
              selfSourceId={selfSourceId}
              value={settings.relation}
              onChange={(relation) => patchSettings({ relation })}
            />
          ) : null}

          {type === 'ROLLUP' ? (
            <RollupConfig
              properties={siblingProperties}
              value={settings.rollup}
              onChange={(rollup) => patchSettings({ rollup })}
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="contained" onClick={save} disabled={updateProperty.isPending}>
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
