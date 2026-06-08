'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@repo/ui/components'

import { DatabaseToolbar } from '../database-toolbar'
import { useViewRows } from '../use-view-rows'
import { optionsOf, parseViewSettings } from '../types'
import type { DatabasePropertyView, DatabaseRowView, DatabaseViewProps } from '../types'

/**
 * LIST layout. A compact vertical list (one row per record) showing the row title
 * plus the view's `visibleProperties` values, rendered read-only. Clicking a row
 * opens the item modal (`?rowId=`). Paginated via `useViewRows` with a
 * "Загрузить ещё" affordance. Server-applied filters/sorts come baked into the
 * fetched pages; editing happens in the item modal.
 */
export function DatabaseListView({
  pageId,
  viewId,
  view,
  properties,
  systemTitleProperty,
  editable,
}: DatabaseViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])

  // Visible properties (display-only): null/absent → all, sorted by position.
  const visibleProperties = useMemo<DatabasePropertyView[]>(() => {
    const sorted = [...properties].sort((a, b) => a.position - b.position)
    const visible = settings.visibleProperties
    if (!visible) return sorted
    const allowed = new Set(visible)
    return sorted.filter((p) => allowed.has(p.id))
  }, [properties, settings.visibleProperties])

  const { rows, fetchNextPage, hasNextPage, isLoading, isFetchingNextPage } = useViewRows(
    pageId,
    viewId,
  )

  function openRow(rowId: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('rowId', rowId)
    router.replace(`?${params.toString()}`)
  }

  return (
    <Stack sx={{ flex: 1, minHeight: 0, bgcolor: 'background.paper' }}>
      <DatabaseToolbar
        pageId={pageId}
        view={view}
        properties={properties}
        systemTitleProperty={systemTitleProperty}
        search=""
        onSearchChange={() => {}}
        editable={editable}
      />

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            Пока нет строк
          </Typography>
        ) : (
          <Stack divider={<Divider />}>
            {rows.map((row) => (
              <ListRow
                key={row.rowId}
                row={row}
                titleLabel={systemTitleProperty.name}
                properties={visibleProperties}
                onOpen={() => openRow(row.rowId)}
              />
            ))}
          </Stack>
        )}

        {hasNextPage ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
            <Button size="small" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {isFetchingNextPage ? 'Загрузка…' : 'Загрузить ещё'}
            </Button>
          </Box>
        ) : null}
      </Box>
    </Stack>
  )
}

interface ListRowProps {
  readonly row: DatabaseRowView
  readonly titleLabel: string
  readonly properties: DatabasePropertyView[]
  readonly onOpen: () => void
}

function ListRow({ row, titleLabel, properties, onOpen }: ListRowProps) {
  return (
    <Box
      onClick={onOpen}
      sx={{
        px: 2,
        py: 1.25,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }} title={titleLabel} noWrap>
        {row.title?.trim() || 'Без названия'}
      </Typography>
      {properties.length > 0 ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}
        >
          {properties.map((property) => (
            <ListPropertyValue key={property.id} row={row} property={property} />
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}

/** Read-only rendering of a single property value in the list row. */
function ListPropertyValue({
  row,
  property,
}: {
  row: DatabaseRowView
  property: DatabasePropertyView
}) {
  const value = row.cells[property.id]
  if (value == null || value === '') return null

  if (property.type === 'SELECT' || property.type === 'STATUS') {
    const option = optionsOf(property).find((o) => o.id === value)
    if (!option) return null
    return (
      <Chip
        size="small"
        label={option.label}
        sx={option.color ? { bgcolor: option.color, color: '#fff' } : undefined}
      />
    )
  }

  if (property.type === 'CHECKBOX') {
    return (
      <Typography variant="caption" color="text.secondary">
        {property.name}: {value ? 'да' : 'нет'}
      </Typography>
    )
  }

  return (
    <Typography variant="caption" color="text.secondary" noWrap>
      {property.name}: {formatScalar(value)}
    </Typography>
  )
}

function formatScalar(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  if (typeof value === 'string') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return d.toLocaleDateString('ru-RU')
    }
    return value
  }
  return String(value)
}
