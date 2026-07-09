'use client'

import { useEffect, useState } from 'react'

import {
  AddIcon,
  Box,
  Button,
  DeleteIcon,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import type { FilterOperator } from '@repo/domain/database/dto/database.dto.ts'

import { trpc } from '@/trpc/client'

import type { DashboardGlobalFilterDto } from '@repo/trpc'

// The operators meaningful for a cross-source global filter (a scalar
// property-name match). The server applies a filter to a widget ONLY when its
// source has a VISIBLE property of that name + compatible type (spec invariant 4),
// so this is a broad, type-agnostic operator set; an incompatible widget ignores it.
const OPERATORS: ReadonlyArray<{ op: FilterOperator; label: string }> = [
  { op: 'equals', label: 'равно' },
  { op: 'contains', label: 'содержит' },
  { op: 'gt', label: 'больше' },
  { op: 'lt', label: 'меньше' },
  { op: 'is_empty', label: 'пусто' },
  { op: 'is_not_empty', label: 'не пусто' },
]

const VALUELESS = new Set<FilterOperator>(['is_empty', 'is_not_empty'])

interface DraftFilter {
  propertyName: string
  operator: FilterOperator
  value: string
}

interface GlobalFilterBarProps {
  readonly dashboardId: string
  readonly filters: DashboardGlobalFilterDto[]
  /** Edit affordances are shown only to editors; viewers see the chips read-only. */
  readonly editable: boolean
  readonly onSaved: () => void
}

/**
 * The dashboard's global-filter bar. In edit mode an editor adds/removes
 * cross-widget filters (a property NAME + operator + value) and persists the full
 * set via `dashboard.setGlobalFilters`. A global filter is applied to a widget
 * ONLY where that widget's source has a visible matching-name + compatible-type
 * property — the SERVER decides per-widget compatibility (spec invariant 4); the
 * bar just declares the filters. In view mode the filters render as read-only
 * chips (so a viewer sees which filters are in effect).
 */
export function GlobalFilterBar({ dashboardId, filters, editable, onSaved }: GlobalFilterBarProps) {
  const utils = trpc.useUtils()
  const [drafts, setDrafts] = useState<DraftFilter[]>([])

  // Seed the editable drafts from the persisted filters (string-coerce the value).
  useEffect(() => {
    setDrafts(
      filters.map((f) => ({
        propertyName: f.propertyName,
        operator: f.operator,
        value: f.value == null ? '' : String(f.value),
      })),
    )
  }, [filters])

  const setMutation = trpc.dashboard.setGlobalFilters.useMutation()
  const saving = setMutation.isPending

  async function persist(next: DraftFilter[]) {
    const clean = next.filter((d) => d.propertyName.trim().length > 0)
    await setMutation.mutateAsync({
      dashboardId,
      filters: clean.map((d) => ({
        propertyName: d.propertyName.trim(),
        operator: d.operator,
        ...(VALUELESS.has(d.operator) || d.value === '' ? {} : { value: d.value }),
      })),
    })
    await utils.dashboard.getByPage.invalidate()
    await utils.dashboard.dashboardData.invalidate()
    onSaved()
  }

  // ── View mode: read-only chips ────────────────────────────────────────────
  if (!editable) {
    if (filters.length === 0) return null
    return (
      <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          Глобальные фильтры:
        </Typography>
        {filters.map((f) => (
          <Box
            key={f.id}
            sx={{
              px: 1,
              py: 0.25,
              borderRadius: 1,
              bgcolor: 'action.hover',
              fontSize: 13,
            }}
          >
            {f.propertyName} {OPERATORS.find((o) => o.op === f.operator)?.label ?? f.operator}
            {f.value != null && !VALUELESS.has(f.operator) ? ` ${String(f.value)}` : ''}
          </Box>
        ))}
      </Stack>
    )
  }

  // ── Edit mode: add/remove rows ────────────────────────────────────────────
  function updateDraft(index: number, patch: Partial<DraftFilter>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
  }

  return (
    <Box
      sx={{
        mb: 2,
        p: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
      }}
      data-testid="global-filter-bar"
    >
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Глобальные фильтры
      </Typography>
      <Stack spacing={1}>
        {drafts.map((draft, index) => (
          <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Имя свойства"
              value={draft.propertyName}
              onChange={(e) => updateDraft(index, { propertyName: e.target.value })}
              sx={{ width: 180 }}
              slotProps={{ htmlInput: { 'aria-label': 'Имя свойства' } }}
            />
            <Select
              size="small"
              value={draft.operator}
              onChange={(e) => updateDraft(index, { operator: e.target.value as FilterOperator })}
              sx={{ width: 130, fontSize: 14 }}
              aria-label="Оператор"
            >
              {OPERATORS.map((o) => (
                <MenuItem key={o.op} value={o.op}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {VALUELESS.has(draft.operator) ? null : (
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Значение"
                  value={draft.value}
                  onChange={(e) => updateDraft(index, { value: e.target.value })}
                  slotProps={{ htmlInput: { 'aria-label': 'Значение' } }}
                />
              )}
            </Box>
            <IconButton
              size="small"
              aria-label="Удалить фильтр"
              onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== index))}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() =>
            setDrafts((prev) => [...prev, { propertyName: '', operator: 'equals', value: '' }])
          }
        >
          Добавить фильтр
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={saving}
          onClick={() => void persist(drafts)}
          data-testid="global-filter-apply"
        >
          Применить
        </Button>
      </Stack>
    </Box>
  )
}
