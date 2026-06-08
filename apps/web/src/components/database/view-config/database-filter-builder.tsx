'use client'

import { useMemo } from 'react'
import {
  AddIcon,
  Box,
  Button,
  Checkbox,
  DeleteIcon,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@repo/ui/components'
import type { DatabasePropertyType } from '@repo/db'
// Type-only import — the dto's runtime drags the @repo/db/pg adapter into the
// client bundle, so the sentinel is redefined client-side in ../types.
import type {
  FilterCondition,
  FilterGroup,
  FilterOperator,
} from '@repo/domain/database/dto/database.dto.ts'

import { trpc } from '@/trpc/client'

import { TITLE_SENTINEL, optionsOf, parseViewSettings } from '../types'
import type { DatabasePropertyView, DatabaseSchema, DatabaseViewEntry } from '../types'

interface DatabaseFilterBuilderProps {
  readonly pageId: string
  readonly view: DatabaseViewEntry
  readonly properties: DatabaseSchema['properties']
  readonly systemTitleProperty: DatabaseSchema['systemTitleProperty']
}

// Operators offered per property type, with Russian labels. The system title
// column behaves like TEXT.
const OPERATORS_BY_TYPE: Record<
  DatabasePropertyType,
  ReadonlyArray<{ op: FilterOperator; label: string }>
> = {
  TEXT: [
    { op: 'contains', label: 'содержит' },
    { op: 'equals', label: 'равно' },
    { op: 'is_empty', label: 'пусто' },
    { op: 'is_not_empty', label: 'не пусто' },
  ],
  NUMBER: [
    { op: 'gt', label: 'больше' },
    { op: 'lt', label: 'меньше' },
    { op: 'equals', label: 'равно' },
    { op: 'is_empty', label: 'пусто' },
  ],
  CHECKBOX: [
    { op: 'is_checked', label: 'отмечено' },
    { op: 'is_not_checked', label: 'не отмечено' },
  ],
  SELECT: [
    { op: 'is_any_of', label: 'любой из' },
    { op: 'is_empty', label: 'пусто' },
  ],
  STATUS: [
    { op: 'is_any_of', label: 'любой из' },
    { op: 'is_empty', label: 'пусто' },
  ],
  DATE: [
    { op: 'before', label: 'до' },
    { op: 'after', label: 'после' },
    { op: 'on', label: 'в' },
    { op: 'is_empty', label: 'пусто' },
  ],
  MULTI_SELECT: [
    { op: 'is_any_of', label: 'любой из' },
    { op: 'is_empty', label: 'пусто' },
  ],
  PERSON: [
    { op: 'is_empty', label: 'пусто' },
    { op: 'is_not_empty', label: 'не пусто' },
  ],
  FILE: [
    { op: 'is_empty', label: 'пусто' },
    { op: 'is_not_empty', label: 'не пусто' },
  ],
}

// Operators that take no value editor.
const VALUELESS_OPERATORS = new Set<FilterOperator>([
  'is_empty',
  'is_not_empty',
  'is_checked',
  'is_not_checked',
])

function isGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return 'conjunction' in node
}

function operatorsFor(type: DatabasePropertyType | 'TITLE'): ReadonlyArray<{ op: FilterOperator; label: string }> {
  if (type === 'TITLE') return OPERATORS_BY_TYPE.TEXT
  return OPERATORS_BY_TYPE[type]
}

/**
 * Popover body building the nested AND/OR `FilterGroup` persisted in
 * `view.settings.filters`. The root is always a group with a conjunction toggle
 * (И/ИЛИ); each row is either a condition (property → operator → value editor) or
 * a nested group. Writes `view.settings.filters` via `updateView` (merged into
 * the existing settings) on every change.
 */
export function DatabaseFilterBuilder({
  pageId,
  view,
  properties,
  systemTitleProperty,
}: DatabaseFilterBuilderProps) {
  const utils = trpc.useUtils()
  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])

  const sortedProperties = useMemo(
    () => [...properties].sort((a, b) => a.position - b.position),
    [properties],
  )

  const root: FilterGroup = settings.filters ?? { conjunction: 'and', conditions: [] }

  const updateView = trpc.database.updateView.useMutation({
    onSuccess: async () => {
      // Schema (getByPage) AND the row-bearing queries must refetch — a filter
      // change re-resolves which rows listRows/listGroupedRows return.
      await Promise.all([
        utils.database.getByPage.invalidate({ pageId }),
        utils.database.listRows.invalidate(),
        utils.database.listGroupedRows.invalidate(),
      ])
    },
  })

  function persist(next: FilterGroup) {
    // Clear filters entirely when the root group is emptied.
    const filters = next.conditions.length > 0 ? next : undefined
    updateView.mutate({ pageId, id: view.id, settings: { ...settings, filters } })
  }

  return (
    <Box sx={{ p: 1.5, width: 460, maxHeight: 480, overflowY: 'auto' }}>
      <Typography variant="subtitle2" sx={{ px: 0.5 }}>
        Фильтры
      </Typography>
      <Divider sx={{ my: 1 }} />
      <GroupEditor
        group={root}
        depth={0}
        properties={sortedProperties}
        systemTitleName={systemTitleProperty.name}
        onChange={persist}
      />
    </Box>
  )
}

function GroupEditor({
  group,
  depth,
  properties,
  systemTitleName,
  onChange,
}: {
  group: FilterGroup
  depth: number
  properties: DatabasePropertyView[]
  systemTitleName: string
  onChange: (next: FilterGroup) => void
}) {
  function setConjunction(conjunction: 'and' | 'or') {
    onChange({ ...group, conjunction })
  }

  function updateChild(index: number, child: FilterCondition | FilterGroup) {
    onChange({ ...group, conditions: group.conditions.map((c, i) => (i === index ? child : c)) })
  }

  function removeChild(index: number) {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) })
  }

  function addCondition() {
    const first = properties[0]
    const propertyId = first?.id ?? TITLE_SENTINEL
    const type = first ? first.type : 'TEXT'
    const op = operatorsFor(first ? type : 'TITLE')[0]?.op ?? 'contains'
    onChange({
      ...group,
      conditions: [...group.conditions, { propertyId, operator: op, value: undefined }],
    })
  }

  function addGroup() {
    onChange({
      ...group,
      conditions: [...group.conditions, { conjunction: 'and', conditions: [] }],
    })
  }

  return (
    <Box
      sx={
        depth > 0
          ? { border: 1, borderColor: 'divider', borderRadius: 1, p: 1, mb: 1 }
          : undefined
      }
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={group.conjunction}
          onChange={(_, value: 'and' | 'or' | null) => value && setConjunction(value)}
        >
          <ToggleButton value="and" sx={{ px: 1.5, py: 0.25 }}>
            И
          </ToggleButton>
          <ToggleButton value="or" sx={{ px: 1.5, py: 0.25 }}>
            ИЛИ
          </ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary">
          {group.conjunction === 'and' ? 'выполнены все условия' : 'выполнено любое условие'}
        </Typography>
      </Stack>

      <Stack spacing={1}>
        {group.conditions.map((child, index) =>
          isGroup(child) ? (
            <Stack key={index} direction="row" spacing={0.5} alignItems="flex-start">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <GroupEditor
                  group={child}
                  depth={depth + 1}
                  properties={properties}
                  systemTitleName={systemTitleName}
                  onChange={(next) => updateChild(index, next)}
                />
              </Box>
              <IconButton size="small" aria-label="Удалить группу" onClick={() => removeChild(index)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ) : (
            <ConditionEditor
              key={index}
              condition={child}
              properties={properties}
              systemTitleName={systemTitleName}
              onChange={(next) => updateChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          ),
        )}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button size="small" startIcon={<AddIcon />} onClick={addCondition}>
          Добавить условие
        </Button>
        {depth < 2 ? (
          <Button size="small" startIcon={<AddIcon />} onClick={addGroup}>
            Добавить группу
          </Button>
        ) : null}
      </Stack>
    </Box>
  )
}

function ConditionEditor({
  condition,
  properties,
  systemTitleName,
  onChange,
  onRemove,
}: {
  condition: FilterCondition
  properties: DatabasePropertyView[]
  systemTitleName: string
  onChange: (next: FilterCondition) => void
  onRemove: () => void
}) {
  const property = properties.find((p) => p.id === condition.propertyId)
  const effectiveType: DatabasePropertyType | 'TITLE' =
    condition.propertyId === TITLE_SENTINEL ? 'TITLE' : (property?.type ?? 'TEXT')
  const operators = operatorsFor(effectiveType)

  function changeProperty(propertyId: string) {
    const nextProp = properties.find((p) => p.id === propertyId)
    const nextType: DatabasePropertyType | 'TITLE' =
      propertyId === TITLE_SENTINEL ? 'TITLE' : (nextProp?.type ?? 'TEXT')
    const nextOp = operatorsFor(nextType)[0]?.op ?? 'contains'
    onChange({ propertyId, operator: nextOp, value: undefined })
  }

  function changeOperator(operator: FilterOperator) {
    onChange({ ...condition, operator, value: VALUELESS_OPERATORS.has(operator) ? undefined : condition.value })
  }

  function changeValue(value: unknown) {
    onChange({ ...condition, value })
  }

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Select
        size="small"
        value={condition.propertyId}
        onChange={(e) => changeProperty(String(e.target.value))}
        sx={{ width: 130, fontSize: 14 }}
        aria-label="Свойство фильтра"
      >
        <MenuItem value={TITLE_SENTINEL}>{systemTitleName}</MenuItem>
        {properties.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
          </MenuItem>
        ))}
      </Select>
      <Select
        size="small"
        value={condition.operator}
        onChange={(e) => changeOperator(e.target.value as FilterOperator)}
        sx={{ width: 130, fontSize: 14 }}
        aria-label="Оператор"
      >
        {operators.map((o) => (
          <MenuItem key={o.op} value={o.op}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <ValueEditor
          operator={condition.operator}
          type={effectiveType}
          property={property}
          value={condition.value}
          onChange={changeValue}
        />
      </Box>
      <IconButton size="small" aria-label="Удалить условие" onClick={onRemove}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}

function ValueEditor({
  operator,
  type,
  property,
  value,
  onChange,
}: {
  operator: FilterOperator
  type: DatabasePropertyType | 'TITLE'
  property: DatabasePropertyView | undefined
  value: unknown
  onChange: (value: unknown) => void
}) {
  if (VALUELESS_OPERATORS.has(operator)) return null

  if (operator === 'is_any_of' || operator === 'is_none_of') {
    const options = property ? optionsOf(property) : []
    const selected = Array.isArray(value) ? (value as string[]) : []
    return (
      <Select
        size="small"
        multiple
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        sx={{ width: '100%', fontSize: 14 }}
        renderValue={(ids) =>
          (ids as string[]).map((id) => options.find((o) => o.id === id)?.label ?? id).join(', ')
        }
        aria-label="Значения"
      >
        {options.map((opt) => (
          <MenuItem key={opt.id} value={opt.id}>
            <Checkbox size="small" checked={selected.includes(opt.id)} />
            {opt.label}
          </MenuItem>
        ))}
      </Select>
    )
  }

  if (type === 'NUMBER') {
    return (
      <TextField
        size="small"
        type="number"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        fullWidth
        inputProps={{ 'aria-label': 'Значение' }}
      />
    )
  }

  if (type === 'DATE') {
    const dateStr = typeof value === 'string' ? value.slice(0, 10) : ''
    return (
      <TextField
        size="small"
        type="date"
        value={dateStr}
        onChange={(e) =>
          onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)
        }
        fullWidth
        inputProps={{ 'aria-label': 'Дата' }}
      />
    )
  }

  // TEXT / TITLE
  return (
    <TextField
      size="small"
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      fullWidth
      inputProps={{ 'aria-label': 'Значение' }}
    />
  )
}
