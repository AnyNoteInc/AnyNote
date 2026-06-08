'use client'

import { useMemo } from 'react'
import {
  AddIcon,
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  Button,
  DeleteIcon,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@repo/ui/components'
// Type-only import — the dto's runtime drags the @repo/db/pg adapter into the
// client bundle, so the sentinel is redefined client-side in ../types.
import type { Sort } from '@repo/domain/database/dto/database.dto.ts'

import { trpc } from '@/trpc/client'

import { TITLE_SENTINEL, parseViewSettings } from '../types'
import type { DatabaseSchema, DatabaseViewEntry } from '../types'

interface DatabaseSortBuilderProps {
  readonly pageId: string
  readonly view: DatabaseViewEntry
  readonly properties: DatabaseSchema['properties']
  readonly systemTitleProperty: DatabaseSchema['systemTitleProperty']
}

/**
 * Popover body editing the view's ordered sort list. Each row is a
 * `{ propertyId, direction }`; "Название" maps to the `__title__` sentinel.
 * Writes `view.settings.sorts` via `updateView` (merged into existing settings).
 *
 * NOTE: per the backend query-planner, only a `__title__` sort is applied at the
 * DB level; cell-value sorts currently fall back to stable position order. The
 * list is still persisted so the intent is captured and the planner can honour it
 * once cell-value ordering lands.
 */
export function DatabaseSortBuilder({
  pageId,
  view,
  properties,
  systemTitleProperty,
}: DatabaseSortBuilderProps) {
  const utils = trpc.useUtils()
  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])
  const sorts = useMemo(() => settings.sorts ?? [], [settings.sorts])

  const sortedProperties = useMemo(
    () => [...properties].sort((a, b) => a.position - b.position),
    [properties],
  )

  const propertyName = (propertyId: string): string => {
    if (propertyId === TITLE_SENTINEL) return systemTitleProperty.name
    return sortedProperties.find((p) => p.id === propertyId)?.name ?? propertyId
  }

  const updateView = trpc.database.updateView.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.database.getByPage.invalidate({ pageId }),
        utils.database.listRows.invalidate(),
        utils.database.listGroupedRows.invalidate(),
      ])
    },
  })

  function persist(next: Sort[]) {
    updateView.mutate({ pageId, id: view.id, settings: { ...settings, sorts: next } })
  }

  // The first available property/title not already in the sort list.
  function firstUnusedPropertyId(): string | null {
    const used = new Set(sorts.map((s) => s.propertyId))
    if (!used.has(TITLE_SENTINEL)) return TITLE_SENTINEL
    const free = sortedProperties.find((p) => !used.has(p.id))
    return free?.id ?? null
  }

  function addSort() {
    const propertyId = firstUnusedPropertyId()
    if (!propertyId) return
    persist([...sorts, { propertyId, direction: 'asc' }])
  }

  function updateSort(index: number, patch: Partial<Sort>) {
    persist(sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function removeSort(index: number) {
    persist(sorts.filter((_, i) => i !== index))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= sorts.length) return
    const next = [...sorts]
    const [item] = next.splice(index, 1)
    if (item) next.splice(target, 0, item)
    persist(next)
  }

  const allOptions = [
    { id: TITLE_SENTINEL, name: systemTitleProperty.name },
    ...sortedProperties.map((p) => ({ id: p.id, name: p.name })),
  ]
  const noMoreToAdd = firstUnusedPropertyId() === null

  return (
    <Box sx={{ p: 1.5, width: 340 }}>
      <Typography variant="subtitle2" sx={{ px: 0.5 }}>
        Сортировка
      </Typography>
      <Divider sx={{ my: 1 }} />

      {sorts.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
          Сортировка не задана.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {sorts.map((sort, index) => (
            <Stack key={`${sort.propertyId}-${index}`} direction="row" spacing={0.5} alignItems="center">
              <Stack>
                <IconButton
                  size="small"
                  aria-label="Выше"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  sx={{ p: 0 }}
                >
                  <ArrowDropUpIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Ниже"
                  disabled={index === sorts.length - 1}
                  onClick={() => move(index, 1)}
                  sx={{ p: 0 }}
                >
                  <ArrowDropDownIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Select
                size="small"
                value={sort.propertyId}
                onChange={(e) => updateSort(index, { propertyId: String(e.target.value) })}
                sx={{ flex: 1, fontSize: 14 }}
                aria-label={`Свойство сортировки ${propertyName(sort.propertyId)}`}
              >
                {allOptions.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>
                    {opt.name}
                  </MenuItem>
                ))}
              </Select>
              <Select
                size="small"
                value={sort.direction}
                onChange={(e) => updateSort(index, { direction: e.target.value as Sort['direction'] })}
                sx={{ width: 130, fontSize: 14 }}
                aria-label="Направление"
              >
                <MenuItem value="asc">По возрастанию</MenuItem>
                <MenuItem value="desc">По убыванию</MenuItem>
              </Select>
              <IconButton size="small" aria-label="Удалить сортировку" onClick={() => removeSort(index)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </Stack>
      )}

      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={addSort}
        disabled={noMoreToAdd}
        sx={{ mt: 1 }}
      >
        Добавить сортировку
      </Button>
    </Box>
  )
}
