'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Popover,
  Stack,
  TuneIcon,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import type { RouterOutputs } from '@/trpc/client'

import { DatabaseToolbar } from '../database-toolbar'
import { GroupByPicker } from '../view-config/group-by-picker'
import { positionBetween } from '../../kanban/lib/positions'
import { optionsOf, parseViewSettings } from '../types'
import type { DatabasePropertyView, DatabaseRowView, DatabaseViewProps } from '../types'

type GroupedRowsResult = RouterOutputs['database']['listGroupedRows']

/** The sentinel droppableId for the trailing "Без статуса" (null) column. */
const EMPTY_KEY = '__empty__'

/** A column the board renders: a groupBy option (or the trailing empty bucket). */
interface BoardColumn {
  readonly key: string | null
  readonly label: string
  readonly color: string | null
  readonly rows: DatabaseRowView[]
}

/**
 * BOARD layout. Columns are DERIVED from the groupBy property's options (a
 * STATUS/SELECT/PERSON property resolved from `view.settings.groupBy.propertyId`)
 * plus a trailing "Без статуса" column for ungrouped rows. Rows are bucketed
 * server-side via `listGroupedRows` (no pagination — a focused board is bounded).
 *
 * Drag (via `@hello-pangea/dnd`) optimistically moves the card, sets the group
 * property to the destination column's option id (`updateCellValue`), and
 * persists the new ordering (`reorderRows`, positions via `positionBetween`).
 * Clicking a card (not dragging) opens the item modal (`?rowId=`).
 */
export function DatabaseBoardView({
  pageId,
  viewId,
  view,
  properties,
  systemTitleProperty,
  editable,
}: DatabaseViewProps) {
  const utils = trpc.useUtils()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)

  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])
  const groupByPropertyId = settings.groupBy?.propertyId ?? null

  const groupByProperty = useMemo(
    () => (groupByPropertyId ? properties.find((p) => p.id === groupByPropertyId) ?? null : null),
    [properties, groupByPropertyId],
  )

  const { data, isLoading } = trpc.database.listGroupedRows.useQuery(
    { pageId, viewId },
    { retry: false, enabled: Boolean(groupByProperty) },
  )

  // Card properties: explicit `layout.cardProperties` if set, else a short default
  // (the groupBy property + the first couple of other properties). Title is always
  // shown as the card heading and is never listed here.
  const cardProperties = useMemo<DatabasePropertyView[]>(() => {
    const byId = new Map(properties.map((p) => [p.id, p]))
    const explicit = settings.layout?.cardProperties
    if (explicit) {
      return explicit.map((id) => byId.get(id)).filter((p): p is DatabasePropertyView => Boolean(p))
    }
    const sorted = [...properties].sort((a, b) => a.position - b.position)
    return sorted.slice(0, 3)
  }, [properties, settings.layout?.cardProperties])

  // Build the column list from the groupBy options (stable order, incl. empty
  // ones), filling each bucket from the server-grouped rows by key.
  const columns = useMemo<BoardColumn[]>(() => {
    if (!groupByProperty) return []
    const rowsByKey = new Map<string | null, DatabaseRowView[]>()
    for (const group of data?.groups ?? []) rowsByKey.set(group.key, group.rows)
    const optionColumns: BoardColumn[] = optionsOf(groupByProperty).map((opt) => ({
      key: opt.id,
      label: opt.label,
      color: opt.color ?? null,
      rows: rowsByKey.get(opt.id) ?? [],
    }))
    return [
      ...optionColumns,
      { key: null, label: 'Без статуса', color: null, rows: rowsByKey.get(null) ?? [] },
    ]
  }, [groupByProperty, data?.groups])

  const updateCellValue = trpc.database.updateCellValue.useMutation()
  const setRowPosition = trpc.database.setRowPosition.useMutation()

  function invalidate() {
    utils.database.listGroupedRows.invalidate({ pageId, viewId })
    // A group change can move a row across other views' filters/sorts too.
    utils.database.listRows.invalidate({ pageId })
  }

  /** Patch the grouped-rows cache in place: move `rowId` into `destKey` at `index`. */
  function setGroupedData(updater: (prev: GroupedRowsResult | undefined) => GroupedRowsResult | undefined) {
    const setData = utils.database.listGroupedRows.setData as (
      input: { pageId: string; viewId: string },
      next: (prev: GroupedRowsResult | undefined) => GroupedRowsResult | undefined,
    ) => void
    setData({ pageId, viewId }, updater)
  }

  async function handleDragEnd(result: DropResult) {
    if (!result.destination || !groupByProperty) return
    const fromKey = result.source.droppableId === EMPTY_KEY ? null : result.source.droppableId
    const toKey = result.destination.droppableId === EMPTY_KEY ? null : result.destination.droppableId
    const rowId = result.draggableId
    if (fromKey === toKey && result.source.index === result.destination.index) return

    const destColumn = columns.find((c) => c.key === toKey)
    if (!destColumn) return
    const moved = columns
      .flatMap((c) => c.rows)
      .find((r) => r.rowId === rowId)
    if (!moved) return

    const destWithoutMoved = destColumn.rows.filter((r) => r.rowId !== rowId)
    const before = destWithoutMoved[result.destination.index - 1] ?? null
    const after = destWithoutMoved[result.destination.index] ?? null
    const newPosition = positionBetween(before?.position ?? null, after?.position ?? null)

    // Optimistic: drop the row from every bucket, then splice it into the dest
    // bucket at the target index with its new group value + position.
    setGroupedData((prev) => {
      if (!prev) return prev
      const groups = prev.groups.map((g) => ({
        ...g,
        rows: g.rows.filter((r) => r.rowId !== rowId),
      }))
      const updatedRow: DatabaseRowView = {
        ...moved,
        position: newPosition,
        cells: { ...moved.cells, [groupByProperty.id]: toKey },
      }
      const dest = groups.find((g) => g.key === toKey)
      if (dest) {
        const next = [...dest.rows]
        next.splice(result.destination!.index, 0, updatedRow)
        dest.rows = next
      }
      return { ...prev, groups }
    })

    try {
      if (fromKey !== toKey) {
        await updateCellValue.mutateAsync({
          pageId,
          rowId,
          propertyId: groupByProperty.id,
          value: toKey,
        })
      }
      // Persist ONLY the dragged row's fractional position (computed above via
      // positionBetween). This keeps each board column's positions isolated —
      // reorderRows would reassign the whole column to N*1024 and contaminate the
      // shared position space used by the table/list views.
      await setRowPosition.mutateAsync({ pageId, rowId, position: newPosition })
      invalidate()
    } catch {
      invalidate()
    }
  }

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

      {editable ? (
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}
        >
          <Button
            size="small"
            color="inherit"
            startIcon={<TuneIcon />}
            onClick={(e) => setPickerAnchor(e.currentTarget)}
          >
            Группировка{groupByProperty ? `: ${groupByProperty.name}` : ''}
          </Button>
          <Popover
            open={Boolean(pickerAnchor)}
            anchorEl={pickerAnchor}
            onClose={() => setPickerAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <GroupByPicker pageId={pageId} view={view} properties={properties} />
          </Popover>
        </Stack>
      ) : null}

      {!groupByProperty ? (
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4 }}>
          <Stack spacing={2} alignItems="center">
            <Typography color="text.secondary" textAlign="center">
              Чтобы построить доску, выберите свойство «Статус» или «Выбор» для группировки.
            </Typography>
            {editable ? (
              <Button
                variant="contained"
                startIcon={<TuneIcon />}
                onClick={(e) => setPickerAnchor(e.currentTarget)}
              >
                Выбрать группировку
              </Button>
            ) : null}
          </Stack>
        </Box>
      ) : isLoading ? (
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
          <DragDropContext onDragEnd={handleDragEnd}>
            <Stack direction="row" spacing={2} sx={{ height: '100%', alignItems: 'flex-start' }}>
              {columns.map((column) => (
                <BoardColumnView
                  key={column.key ?? EMPTY_KEY}
                  column={column}
                  cardProperties={cardProperties}
                  editable={editable}
                  onOpenRow={openRow}
                />
              ))}
            </Stack>
          </DragDropContext>
        </Box>
      )}
    </Stack>
  )
}

interface BoardColumnViewProps {
  readonly column: BoardColumn
  readonly cardProperties: DatabasePropertyView[]
  readonly editable: boolean
  readonly onOpenRow: (rowId: string) => void
}

function BoardColumnView({ column, cardProperties, editable, onOpenRow }: BoardColumnViewProps) {
  const droppableId = column.key ?? EMPTY_KEY
  return (
    <Box sx={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.5, py: 1 }}>
        <Chip
          size="small"
          label={column.label}
          sx={
            column.color
              ? { bgcolor: column.color, color: '#fff', fontWeight: 600 }
              : { fontWeight: 600 }
          }
        />
        <Typography variant="caption" color="text.secondary">
          {column.rows.length}
        </Typography>
      </Stack>

      <Droppable droppableId={droppableId} isDropDisabled={!editable}>
        {(provided, snapshot) => (
          <Stack
            ref={provided.innerRef}
            {...provided.droppableProps}
            spacing={1}
            sx={{
              minHeight: 80,
              p: 1,
              borderRadius: 1,
              bgcolor: snapshot.isDraggingOver ? 'action.hover' : 'background.default',
              transition: 'background-color 0.15s',
            }}
          >
            {column.rows.map((row, index) => (
              <Draggable key={row.rowId} draggableId={row.rowId} index={index} isDragDisabled={!editable}>
                {(dragProvided) => (
                  <Box
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                  >
                    <BoardCard
                      row={row}
                      cardProperties={cardProperties}
                      onOpen={() => onOpenRow(row.rowId)}
                    />
                  </Box>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {column.rows.length === 0 ? (
              <Typography variant="caption" color="text.disabled" sx={{ px: 0.5, py: 1 }}>
                Нет строк
              </Typography>
            ) : null}
          </Stack>
        )}
      </Droppable>
    </Box>
  )
}

interface BoardCardProps {
  readonly row: DatabaseRowView
  readonly cardProperties: DatabasePropertyView[]
  readonly onOpen: () => void
}

/**
 * Compact, read-only card. Editing happens in the item modal (opened on click);
 * keeping the card non-interactive avoids click/drag conflicts with @hello-pangea/dnd.
 */
function BoardCard({ row, cardProperties, onOpen }: BoardCardProps) {
  return (
    <Card
      variant="outlined"
      onClick={onOpen}
      sx={{ cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
    >
      <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {row.title?.trim() || 'Без названия'}
        </Typography>
        {cardProperties.length > 0 ? (
          <Stack spacing={0.5} sx={{ mt: 0.75 }}>
            {cardProperties.map((property) => (
              <CardPropertyValue key={property.id} row={row} property={property} />
            ))}
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Read-only rendering of a single property value on a card. */
function CardPropertyValue({
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
        sx={option.color ? { bgcolor: option.color, color: '#fff', alignSelf: 'flex-start' } : { alignSelf: 'flex-start' }}
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
    // DATE cells store ISO strings; show just the date portion when it parses.
    const d = new Date(value)
    if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return d.toLocaleDateString('ru-RU')
    }
    return value
  }
  return String(value)
}
