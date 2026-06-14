'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  AddIcon,
  Box,
  Button,
  CircularProgress,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@repo/ui/components'

import type { DashboardWidgetType, WidgetConfig } from '@repo/domain'
import type {
  FilterCondition,
  FilterGroup,
  FilterOperator,
} from '@repo/domain/database/dto/database.dto.ts'

import { trpc } from '@/trpc/client'

import type { DashboardWidgetDto } from '@repo/trpc'

// ── Sentinels (mirrored client-side; the dto runtime drags @repo/db into the
// client bundle, so we redefine the values rather than import them) ──────────────
const COUNT_SENTINEL = '__count__' as const
const TITLE_SENTINEL = '__title__' as const
const NONE = '__none__'

// Computed-on-read property types — the server REJECTS these as a metric/group
// target (widget-aggregation `COMPUTED_TYPES`). We mirror the set here so the
// pickers never offer a property the server would reject (spec invariant 2 + 8).
const COMPUTED_TYPES = new Set<string>([
  'FORMULA',
  'ROLLUP',
  'CREATED_TIME',
  'CREATED_BY',
  'LAST_EDITED_TIME',
  'LAST_EDITED_BY',
  'RELATION',
])

// Group-by candidate types — choice/person/scalar properties that bucket cleanly
// (the service generalizes `listGroupedRows` bucketing to any non-computed type;
// here we offer the cleanly-bucketing ones).
const GROUPABLE_TYPES = new Set<string>([
  'STATUS',
  'SELECT',
  'PERSON',
  'CHECKBOX',
  'TEXT',
  'NUMBER',
  'DATE',
])

// The measure aggregation (mirrors a subset of the rollup-config labels — the
// numeric/count aggregations meaningful for a single-measure widget). The
// server's `aggregate()` honors each value.
type WidgetAggregation = NonNullable<WidgetConfig['metric']>['aggregation']
const AGGREGATIONS: ReadonlyArray<{ value: WidgetAggregation; label: string }> = [
  { value: 'count_all', label: 'Количество (все)' },
  { value: 'count_values', label: 'Количество значений' },
  { value: 'count_unique', label: 'Количество уникальных' },
  { value: 'count_empty', label: 'Количество пустых' },
  { value: 'count_not_empty', label: 'Количество заполненных' },
  { value: 'sum', label: 'Сумма' },
  { value: 'average', label: 'Среднее' },
  { value: 'min', label: 'Минимум' },
  { value: 'max', label: 'Максимум' },
]

const WIDGET_TYPES: ReadonlyArray<{ value: DashboardWidgetType; label: string }> = [
  { value: 'METRIC', label: 'Метрика' },
  { value: 'NUMBER', label: 'Число' },
  { value: 'GROUPED', label: 'Группировка (таблица)' },
  { value: 'TABLE', label: 'Таблица' },
  { value: 'BAR', label: 'Столбчатая диаграмма' },
  { value: 'LINE', label: 'Линейная диаграмма' },
  { value: 'DONUT', label: 'Кольцевая диаграмма' },
]

// Operators offered per property type (mirror of the database filter-builder).
const OPERATORS_BY_TYPE: Record<string, ReadonlyArray<{ op: FilterOperator; label: string }>> = {
  TITLE: [
    { op: 'contains', label: 'содержит' },
    { op: 'equals', label: 'равно' },
    { op: 'is_empty', label: 'пусто' },
    { op: 'is_not_empty', label: 'не пусто' },
  ],
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
  PERSON: [
    { op: 'is_empty', label: 'пусто' },
    { op: 'is_not_empty', label: 'не пусто' },
  ],
}

const VALUELESS_OPERATORS = new Set<FilterOperator>([
  'is_empty',
  'is_not_empty',
  'is_checked',
  'is_not_checked',
])

type SourceProperty = { id: string; type: string; name: string }

function operatorsFor(type: string): ReadonlyArray<{ op: FilterOperator; label: string }> {
  return OPERATORS_BY_TYPE[type] ?? []
}

// METRIC/NUMBER + grouped types take a measure (metric); TABLE doesn't.
const NEEDS_METRIC = new Set<DashboardWidgetType>([
  'METRIC',
  'NUMBER',
  'GROUPED',
  'BAR',
  'LINE',
  'DONUT',
])
// GROUPED/BAR/LINE/DONUT take a group-by property.
const NEEDS_GROUP_BY = new Set<DashboardWidgetType>(['GROUPED', 'BAR', 'LINE', 'DONUT'])
const IS_CHART = new Set<DashboardWidgetType>(['BAR', 'LINE', 'DONUT'])

interface WidgetSettingsDialogProps {
  readonly open: boolean
  readonly workspaceId: string
  readonly dashboardId: string
  /** When set, the dialog edits this existing widget; otherwise it adds a new one. */
  readonly widget?: DashboardWidgetDto | null
  readonly onClose: () => void
  /** Called after a successful add/update so the caller can refetch. */
  readonly onSaved: () => void
}

/**
 * The add/edit-widget dialog. Picks a source database (workspace sources), an
 * optional base view, the widget type, the measure (metric property +
 * aggregation), the group-by property, widget filters, and chart options — then
 * confirms via `dashboard.addWidget` (new) or `dashboard.updateWidget` (edit).
 *
 * The property pickers offer ONLY visible, non-computed properties (mirroring the
 * server visibility gate in widget-aggregation): a hidden property (not in the
 * chosen view's `visibleProperties`) or a computed one (FORMULA/ROLLUP/RELATION/
 * CREATED/LAST_EDITED metadata) is never selectable, so a saved widget never trips
 * the server `hidden_property` rejection.
 */
export function WidgetSettingsDialog({
  open,
  workspaceId,
  dashboardId,
  widget,
  onClose,
  onSaved,
}: WidgetSettingsDialogProps) {
  const utils = trpc.useUtils()
  const isEdit = Boolean(widget)

  const [sourceId, setSourceId] = useState<string>('')
  const [viewId, setViewId] = useState<string>(NONE)
  const [type, setType] = useState<DashboardWidgetType>('METRIC')
  const [title, setTitle] = useState('')
  const [metricPropertyId, setMetricPropertyId] = useState<string>(COUNT_SENTINEL)
  const [aggregation, setAggregation] = useState<WidgetAggregation>('count_all')
  const [groupByPropertyId, setGroupByPropertyId] = useState<string>(NONE)
  const [filters, setFilters] = useState<FilterCondition[]>([])
  const [color, setColor] = useState('')
  const [showLegend, setShowLegend] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed from the widget on open (edit) / reset (add).
  useEffect(() => {
    if (!open) return
    if (widget) {
      setSourceId(widget.sourceId)
      setViewId(widget.viewId ?? NONE)
      setType(widget.type)
      setTitle(widget.title)
      setMetricPropertyId(widget.config.metric?.propertyId ?? COUNT_SENTINEL)
      setAggregation(widget.config.metric?.aggregation ?? 'count_all')
      setGroupByPropertyId(widget.config.groupByPropertyId ?? NONE)
      const root = widget.config.filters
      setFilters(
        root && Array.isArray(root.conditions)
          ? root.conditions.filter((c): c is FilterCondition => !('conjunction' in c))
          : [],
      )
      setColor(widget.config.chartOptions?.color ?? '')
      setShowLegend(Boolean(widget.config.chartOptions?.showLegend))
    } else {
      setSourceId('')
      setViewId(NONE)
      setType('METRIC')
      setTitle('')
      setMetricPropertyId(COUNT_SENTINEL)
      setAggregation('count_all')
      setGroupByPropertyId(NONE)
      setFilters([])
      setColor('')
      setShowLegend(false)
    }
    setError(null)
  }, [open, widget])

  const sourcesQuery = trpc.database.listSources.useQuery({ workspaceId }, { enabled: open })
  const schemaQuery = trpc.database.getBySourceId.useQuery(
    { sourceId: sourceId || '' },
    { enabled: open && Boolean(sourceId), retry: false },
  )

  const views = useMemo(() => schemaQuery.data?.view.views ?? [], [schemaQuery.data])
  const allProperties: SourceProperty[] = useMemo(
    () =>
      (schemaQuery.data?.view.properties ?? []).map((p) => ({
        id: p.id,
        type: p.type,
        name: p.name,
      })),
    [schemaQuery.data],
  )

  // The chosen view's visible-property set (null = no view → all visible).
  const visibleIds: Set<string> | null = useMemo(() => {
    if (viewId === NONE) return null
    const view = views.find((v) => v.id === viewId)
    const vis = (view?.settings as { visibleProperties?: string[] } | null | undefined)
      ?.visibleProperties
    return Array.isArray(vis) ? new Set(vis) : null
  }, [viewId, views])

  // Selectable = visible (in the view, or all) AND non-computed. Mirrors the
  // server gate so a saved widget never hits `hidden_property`.
  const selectableProperties = useMemo(
    () =>
      allProperties.filter(
        (p) => !COMPUTED_TYPES.has(p.type) && (visibleIds === null || visibleIds.has(p.id)),
      ),
    [allProperties, visibleIds],
  )

  // Metric candidates = the count sentinel + selectable properties.
  const metricCandidates = selectableProperties
  // Group-by candidates = selectable properties of a groupable type.
  const groupByCandidates = useMemo(
    () => selectableProperties.filter((p) => GROUPABLE_TYPES.has(p.type)),
    [selectableProperties],
  )
  // Filter candidates = selectable properties that have at least one operator.
  const filterableProperties = useMemo(
    () => selectableProperties.filter((p) => operatorsFor(p.type).length > 0),
    [selectableProperties],
  )

  const addMutation = trpc.dashboard.addWidget.useMutation()
  const updateMutation = trpc.dashboard.updateWidget.useMutation()
  const saving = addMutation.isPending || updateMutation.isPending

  // Keep the metric/group-by selections valid when the source/view (and thus the
  // selectable set) changes: drop a metric/group property that is no longer offered.
  useEffect(() => {
    if (
      metricPropertyId !== COUNT_SENTINEL &&
      metricPropertyId !== TITLE_SENTINEL &&
      !metricCandidates.some((p) => p.id === metricPropertyId)
    ) {
      setMetricPropertyId(COUNT_SENTINEL)
      setAggregation('count_all')
    }
  }, [metricCandidates, metricPropertyId])

  useEffect(() => {
    if (groupByPropertyId !== NONE && !groupByCandidates.some((p) => p.id === groupByPropertyId)) {
      setGroupByPropertyId(NONE)
    }
  }, [groupByCandidates, groupByPropertyId])

  function buildConfig(): WidgetConfig {
    const cfg: WidgetConfig = {}
    if (NEEDS_METRIC.has(type)) {
      cfg.metric = { propertyId: metricPropertyId, aggregation }
    }
    if (NEEDS_GROUP_BY.has(type) && groupByPropertyId !== NONE) {
      cfg.groupByPropertyId = groupByPropertyId
    }
    const cleanFilters = filters.filter((f) => f.propertyId)
    if (cleanFilters.length > 0) {
      cfg.filters = { conjunction: 'and', conditions: cleanFilters } as FilterGroup
    }
    if (IS_CHART.has(type) && (color || showLegend)) {
      cfg.chartOptions = {
        ...(color ? { color } : {}),
        ...(showLegend ? { showLegend: true } : {}),
      }
    }
    return cfg
  }

  async function handleSave() {
    if (!sourceId) {
      setError('Выберите базу данных')
      return
    }
    if (NEEDS_GROUP_BY.has(type) && groupByPropertyId === NONE) {
      setError('Выберите свойство группировки')
      return
    }
    setError(null)
    const config = buildConfig()
    const trimmedTitle = title.trim()
    try {
      if (widget) {
        await updateMutation.mutateAsync({
          widgetId: widget.id,
          title: trimmedTitle,
          viewId: viewId === NONE ? null : viewId,
          config,
        })
      } else {
        await addMutation.mutateAsync({
          dashboardId,
          sourceId,
          type,
          ...(trimmedTitle ? { title: trimmedTitle } : {}),
          ...(viewId !== NONE ? { viewId } : {}),
          config,
        })
      }
      await utils.dashboard.getByPage.invalidate()
      await utils.dashboard.dashboardData.invalidate()
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить виджет')
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      data-testid="widget-settings-dialog"
    >
      <DialogTitle>{isEdit ? 'Настройки виджета' : 'Добавить виджет'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {/* Source */}
          <FormControl size="small" fullWidth>
            <InputLabel id="widget-source-label">База данных</InputLabel>
            <Select
              labelId="widget-source-label"
              label="База данных"
              value={sourceId || ''}
              disabled={isEdit}
              onChange={(e) => {
                setSourceId(String(e.target.value))
                setViewId(NONE)
              }}
              data-testid="widget-source-select"
            >
              {(sourcesQuery.data ?? []).map((s) => (
                <MenuItem key={s.sourceId} value={s.sourceId}>
                  {s.title || 'Без названия'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {sourcesQuery.data && sourcesQuery.data.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              В этом пространстве пока нет баз данных.
            </Typography>
          ) : null}

          {/* Base view (optional) */}
          <FormControl size="small" fullWidth disabled={!sourceId}>
            <InputLabel id="widget-view-label">Базовое представление</InputLabel>
            <Select
              labelId="widget-view-label"
              label="Базовое представление"
              value={viewId}
              onChange={(e) => setViewId(String(e.target.value))}
              data-testid="widget-view-select"
            >
              <MenuItem value={NONE}>
                <em>Все строки</em>
              </MenuItem>
              {views.map((v) => (
                <MenuItem key={v.id} value={v.id}>
                  {v.title || 'Без названия'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Widget type */}
          <FormControl size="small" fullWidth>
            <InputLabel id="widget-type-label">Тип виджета</InputLabel>
            <Select
              labelId="widget-type-label"
              label="Тип виджета"
              value={type}
              onChange={(e) => setType(e.target.value as DashboardWidgetType)}
              data-testid="widget-type-select"
            >
              {WIDGET_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Title */}
          <TextField
            size="small"
            fullWidth
            label="Название (необязательно)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 200, 'data-testid': 'widget-title' } }}
          />

          {sourceId && schemaQuery.isPending ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
              <CircularProgress size={20} />
            </Box>
          ) : null}

          {/* Measure (metric property + aggregation) */}
          {NEEDS_METRIC.has(type) ? (
            <>
              <Divider textAlign="left">
                <Typography variant="caption" color="text.secondary">
                  Показатель
                </Typography>
              </Divider>
              <Stack direction="row" spacing={1}>
                <FormControl size="small" fullWidth disabled={!sourceId}>
                  <InputLabel id="widget-metric-label">Свойство</InputLabel>
                  <Select
                    labelId="widget-metric-label"
                    label="Свойство"
                    value={metricPropertyId}
                    onChange={(e) => {
                      const next = String(e.target.value)
                      setMetricPropertyId(next)
                      if (next === COUNT_SENTINEL) setAggregation('count_all')
                      else if (aggregation === 'count_all') setAggregation('sum')
                    }}
                    data-testid="widget-metric-select"
                  >
                    <MenuItem value={COUNT_SENTINEL}>Количество строк</MenuItem>
                    {metricCandidates.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth disabled={metricPropertyId === COUNT_SENTINEL}>
                  <InputLabel id="widget-agg-label">Агрегация</InputLabel>
                  <Select
                    labelId="widget-agg-label"
                    label="Агрегация"
                    value={aggregation}
                    onChange={(e) => setAggregation(e.target.value as WidgetAggregation)}
                    data-testid="widget-agg-select"
                  >
                    {AGGREGATIONS.map((a) => (
                      <MenuItem key={a.value} value={a.value}>
                        {a.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </>
          ) : null}

          {/* Group-by */}
          {NEEDS_GROUP_BY.has(type) ? (
            <FormControl size="small" fullWidth disabled={!sourceId}>
              <InputLabel id="widget-groupby-label">Группировка по свойству</InputLabel>
              <Select
                labelId="widget-groupby-label"
                label="Группировка по свойству"
                value={groupByPropertyId}
                onChange={(e) => setGroupByPropertyId(String(e.target.value))}
                data-testid="widget-groupby-select"
              >
                <MenuItem value={NONE}>
                  <em>Не выбрано</em>
                </MenuItem>
                {groupByCandidates.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}

          {/* Filters */}
          <Divider textAlign="left">
            <Typography variant="caption" color="text.secondary">
              Фильтры
            </Typography>
          </Divider>
          <WidgetFilterEditor
            disabled={!sourceId}
            properties={filterableProperties}
            value={filters}
            onChange={setFilters}
          />

          {/* Chart options */}
          {IS_CHART.has(type) ? (
            <>
              <Divider textAlign="left">
                <Typography variant="caption" color="text.secondary">
                  Оформление
                </Typography>
              </Divider>
              <Stack direction="row" spacing={2} alignItems="center">
                <TextField
                  size="small"
                  label="Цвет"
                  type="color"
                  value={color || '#1976d2'}
                  onChange={(e) => setColor(e.target.value)}
                  sx={{ width: 120 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={showLegend}
                      onChange={(e) => setShowLegend(e.target.checked)}
                    />
                  }
                  label="Легенда"
                />
              </Stack>
            </>
          ) : null}

          {error ? (
            <Typography variant="body2" color="error.main">
              {error}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={saving || !sourceId}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
          data-testid="widget-settings-save"
        >
          {isEdit ? 'Сохранить' : 'Добавить'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Self-contained filter editor (a flat AND-list; the dialog wraps it in a
// root group on save). Distinct from the view-config DatabaseFilterBuilder, which
// persists straight to a view via updateView — here filters live in widget config. ─
function WidgetFilterEditor({
  disabled,
  properties,
  value,
  onChange,
}: {
  readonly disabled: boolean
  readonly properties: SourceProperty[]
  readonly value: FilterCondition[]
  readonly onChange: (next: FilterCondition[]) => void
}) {
  function update(index: number, next: FilterCondition) {
    onChange(value.map((c, i) => (i === index ? next : c)))
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }
  function add() {
    const first = properties[0]
    const propertyId = first?.id ?? TITLE_SENTINEL
    const type = first?.type ?? 'TITLE'
    const op = operatorsFor(first ? type : 'TITLE')[0]?.op ?? 'contains'
    onChange([...value, { propertyId, operator: op, value: undefined }])
  }

  return (
    <Stack spacing={1}>
      {value.map((condition, index) => {
        const property = properties.find((p) => p.id === condition.propertyId)
        const effectiveType =
          condition.propertyId === TITLE_SENTINEL ? 'TITLE' : (property?.type ?? 'TEXT')
        const operators = operatorsFor(effectiveType)
        return (
          <Stack key={index} direction="row" spacing={0.5} alignItems="center">
            <Select
              size="small"
              value={condition.propertyId}
              onChange={(e) => {
                const nextId = String(e.target.value)
                const nextProp = properties.find((p) => p.id === nextId)
                const nextType = nextId === TITLE_SENTINEL ? 'TITLE' : (nextProp?.type ?? 'TEXT')
                update(index, {
                  propertyId: nextId,
                  operator: operatorsFor(nextType)[0]?.op ?? 'contains',
                  value: undefined,
                })
              }}
              sx={{ width: 130, fontSize: 14 }}
              aria-label="Свойство фильтра"
            >
              <MenuItem value={TITLE_SENTINEL}>Название</MenuItem>
              {properties.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={condition.operator}
              onChange={(e) =>
                update(index, {
                  ...condition,
                  operator: e.target.value as FilterOperator,
                  value: VALUELESS_OPERATORS.has(e.target.value as FilterOperator)
                    ? undefined
                    : condition.value,
                })
              }
              sx={{ width: 120, fontSize: 14 }}
              aria-label="Оператор"
            >
              {operators.map((o) => (
                <MenuItem key={o.op} value={o.op}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {VALUELESS_OPERATORS.has(condition.operator) ? null : effectiveType === 'NUMBER' ? (
                <TextField
                  size="small"
                  type="number"
                  fullWidth
                  value={condition.value == null ? '' : String(condition.value)}
                  onChange={(e) =>
                    update(index, {
                      ...condition,
                      value: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                  inputProps={{ 'aria-label': 'Значение' }}
                />
              ) : effectiveType === 'DATE' ? (
                <TextField
                  size="small"
                  type="date"
                  fullWidth
                  value={typeof condition.value === 'string' ? condition.value.slice(0, 10) : ''}
                  onChange={(e) =>
                    update(index, {
                      ...condition,
                      value: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                    })
                  }
                  inputProps={{ 'aria-label': 'Дата' }}
                />
              ) : (
                <TextField
                  size="small"
                  fullWidth
                  value={condition.value == null ? '' : String(condition.value)}
                  onChange={(e) =>
                    update(index, {
                      ...condition,
                      value: e.target.value === '' ? undefined : e.target.value,
                    })
                  }
                  inputProps={{ 'aria-label': 'Значение' }}
                />
              )}
            </Box>
            <IconButton size="small" aria-label="Удалить условие" onClick={() => remove(index)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        )
      })}
      <Box>
        <Button size="small" startIcon={<AddIcon />} onClick={add} disabled={disabled}>
          Добавить условие
        </Button>
      </Box>
    </Stack>
  )
}
