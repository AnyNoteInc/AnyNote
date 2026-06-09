'use client'

import { useMemo } from 'react'
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { DatabasePropertyView } from '../types'

// Type-only mirrors of the dto enum/shape (no dto runtime in the client bundle).
export type RollupAggregation =
  | 'show_original'
  | 'count_all'
  | 'count_values'
  | 'count_unique'
  | 'count_empty'
  | 'count_not_empty'
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'earliest'
  | 'latest'
  | 'range'

export interface RollupSettings {
  relationPropertyId: string
  targetPropertyId: string
  aggregation: RollupAggregation
}

const AGGREGATIONS: ReadonlyArray<{ value: RollupAggregation; label: string }> = [
  { value: 'show_original', label: 'Показать значения' },
  { value: 'count_all', label: 'Количество (все)' },
  { value: 'count_values', label: 'Количество значений' },
  { value: 'count_unique', label: 'Количество уникальных' },
  { value: 'count_empty', label: 'Количество пустых' },
  { value: 'count_not_empty', label: 'Количество заполненных' },
  { value: 'sum', label: 'Сумма' },
  { value: 'average', label: 'Среднее' },
  { value: 'min', label: 'Минимум' },
  { value: 'max', label: 'Максимум' },
  { value: 'earliest', label: 'Самая ранняя дата' },
  { value: 'latest', label: 'Самая поздняя дата' },
  { value: 'range', label: 'Диапазон' },
]

const TITLE_TARGET = '__title__'
const NONE = '__none__'

interface RollupConfigProps {
  /** All properties on THIS source (to find RELATION properties). */
  readonly properties: DatabasePropertyView[]
  readonly value: RollupSettings | undefined
  readonly onChange: (next: RollupSettings | undefined) => void
  readonly disabled?: boolean
}

/** Read the target source id from a RELATION property's settings. */
function targetSourceIdOf(property: DatabasePropertyView | undefined): string | undefined {
  const relation = property?.settings?.relation
  return relation && typeof relation.targetSourceId === 'string' ? relation.targetSourceId : undefined
}

/**
 * Configure a ROLLUP: pick a RELATION property on THIS source, then a property of
 * the related source to aggregate (or the title), then an aggregation. Writes
 * `settings.rollup = { relationPropertyId, targetPropertyId, aggregation }`.
 */
export function RollupConfig({ properties, value, onChange, disabled }: RollupConfigProps) {
  const relationProps = useMemo(
    () => properties.filter((p) => p.type === 'RELATION'),
    [properties],
  )

  const relationPropertyId = value?.relationPropertyId ?? ''
  const selectedRelation = relationProps.find((p) => p.id === relationPropertyId)
  const targetSourceId = targetSourceIdOf(selectedRelation)

  // Fetch the related source's schema so the target-property picker lists its columns.
  const targetSchema = trpc.database.getBySourceId.useQuery(
    { sourceId: targetSourceId ?? '' },
    { enabled: Boolean(targetSourceId), retry: false },
  )
  const targetProps = useMemo(
    () => targetSchema.data?.view.properties ?? [],
    [targetSchema.data],
  )

  function pickRelation(next: string) {
    if (next === NONE) {
      onChange(undefined)
      return
    }
    // Reset the target property + default aggregation when the relation changes.
    onChange({ relationPropertyId: next, targetPropertyId: TITLE_TARGET, aggregation: 'count_all' })
  }

  function pickTargetProperty(next: string) {
    if (!value) return
    onChange({ ...value, targetPropertyId: next })
  }

  function pickAggregation(next: RollupAggregation) {
    if (!value) return
    onChange({ ...value, aggregation: next })
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Сводка
      </Typography>

      <FormControl size="small" fullWidth disabled={disabled}>
        <InputLabel id="rollup-relation-label">Свойство-связь</InputLabel>
        <Select
          labelId="rollup-relation-label"
          label="Свойство-связь"
          value={relationPropertyId || NONE}
          onChange={(e) => pickRelation(String(e.target.value))}
        >
          <MenuItem value={NONE}>
            <em>Не выбрано</em>
          </MenuItem>
          {relationProps.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {relationProps.length === 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Сначала добавьте свойство-связь (RELATION) в эту базу.
        </Typography>
      ) : null}

      {value ? (
        <>
          <FormControl size="small" fullWidth sx={{ mt: 1.5 }} disabled={disabled}>
            <InputLabel id="rollup-target-label">Свойство для сводки</InputLabel>
            <Select
              labelId="rollup-target-label"
              label="Свойство для сводки"
              value={value.targetPropertyId}
              onChange={(e) => pickTargetProperty(String(e.target.value))}
            >
              <MenuItem value={TITLE_TARGET}>Название</MenuItem>
              {targetProps.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth sx={{ mt: 1.5 }} disabled={disabled}>
            <InputLabel id="rollup-agg-label">Агрегация</InputLabel>
            <Select
              labelId="rollup-agg-label"
              label="Агрегация"
              value={value.aggregation}
              onChange={(e) => pickAggregation(e.target.value as RollupAggregation)}
            >
              {AGGREGATIONS.map((a) => (
                <MenuItem key={a.value} value={a.value}>
                  {a.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </>
      ) : null}
    </Box>
  )
}
