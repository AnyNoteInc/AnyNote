'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import {
  Box,
  Button,
  Chip,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircularProgress,
  Divider,
  IconButton,
  MenuItem,
  Popover,
  Select,
  Stack,
  TuneIcon,
  Typography,
  dateFnsRu,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { DatabaseToolbar } from '../database-toolbar'
import { useViewRows } from '../use-view-rows'
import { parseViewSettings } from '../types'
import type { DatabaseRowView, DatabaseSchema, DatabaseViewProps } from '../types'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Parse a cell's stored DATE value (ISO string) into a Date, or null. */
function rowDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * CALENDAR layout. Resolves the date property from `view.settings.layout.datePropertyId`
 * (a DATE property). Renders a custom month grid (built with `date-fns`, avoiding any
 * MUI Pro deps) and places each row from `useViewRows` on its date-property day cell as
 * a small chip. Rows without a date go to an "Без даты" strip below the grid. Clicking a
 * row opens the item modal (`?rowId=`); prev/next month nav in the header.
 *
 * Drag-to-reschedule is DEFERRED: rescheduling is done via the item modal's date cell.
 * A future iteration can add @hello-pangea/dnd day-cell drop targets that call
 * `updateCellValue` on the date property (the same path the board uses for groupBy).
 */
export function DatabaseCalendarView({
  pageId,
  viewId,
  view,
  properties,
  systemTitleProperty,
  editable,
}: DatabaseViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)

  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])
  const datePropertyId = settings.layout?.datePropertyId ?? null

  const dateProperty = useMemo(
    () =>
      datePropertyId
        ? (properties.find((p) => p.id === datePropertyId && p.type === 'DATE') ?? null)
        : null,
    [properties, datePropertyId],
  )

  const { rows, isLoading } = useViewRows(pageId, viewId)

  // The 6-week grid covering the current month (full weeks, Monday-first).
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [month])

  // Bucket rows by their date-property day; rows without a date go to `undated`.
  const { byDay, undated } = useMemo(() => {
    const map = new Map<string, DatabaseRowView[]>()
    const without: DatabaseRowView[] = []
    if (!dateProperty) return { byDay: map, undated: without }
    for (const row of rows) {
      const date = rowDate(row.cells[dateProperty.id])
      if (!date) {
        without.push(row)
        continue
      }
      const key = format(date, 'yyyy-MM-dd')
      const bucket = map.get(key)
      if (bucket) bucket.push(row)
      else map.set(key, [row])
    }
    return { byDay: map, undated: without }
  }, [rows, dateProperty])

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

      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}
      >
        <IconButton size="small" aria-label="Предыдущий месяц" onClick={() => setMonth((m) => subMonths(m, 1))}>
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle1" sx={{ minWidth: 160, textAlign: 'center', textTransform: 'capitalize' }}>
          {format(month, 'LLLL yyyy', { locale: dateFnsRu })}
        </Typography>
        <IconButton size="small" aria-label="Следующий месяц" onClick={() => setMonth((m) => addMonths(m, 1))}>
          <ChevronRightIcon fontSize="small" />
        </IconButton>
        <Button size="small" color="inherit" onClick={() => setMonth(startOfMonth(new Date()))}>
          Сегодня
        </Button>
        <Box sx={{ flex: 1 }} />
        {editable ? (
          <>
            <Button
              size="small"
              color="inherit"
              startIcon={<TuneIcon />}
              onClick={(e) => setPickerAnchor(e.currentTarget)}
            >
              Дата{dateProperty ? `: ${dateProperty.name}` : ''}
            </Button>
            <Popover
              open={Boolean(pickerAnchor)}
              anchorEl={pickerAnchor}
              onClose={() => setPickerAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <DatePropertyPicker pageId={pageId} view={view} properties={properties} />
            </Popover>
          </>
        ) : null}
      </Stack>

      {!dateProperty ? (
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4 }}>
          <Stack spacing={2} alignItems="center">
            <Typography color="text.secondary" textAlign="center">
              Чтобы построить календарь, выберите свойство типа «Дата».
            </Typography>
            {editable ? (
              <Button
                variant="contained"
                startIcon={<TuneIcon />}
                onClick={(e) => setPickerAnchor(e.currentTarget)}
              >
                Выбрать свойство даты
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
          {/* Weekday header */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, mb: 0.5 }}>
            {WEEKDAYS.map((label) => (
              <Typography
                key={label}
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center', fontWeight: 600 }}
              >
                {label}
              </Typography>
            ))}
          </Box>

          {/* Day grid */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd')
              const dayRows = byDay.get(key) ?? []
              const inMonth = isSameMonth(day, month)
              const isToday = isSameDay(day, new Date())
              return (
                <Box
                  key={key}
                  sx={{
                    minHeight: 96,
                    p: 0.5,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: inMonth ? 'background.paper' : 'action.hover',
                    opacity: inMonth ? 1 : 0.6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: isToday ? 700 : 400,
                      color: isToday ? 'primary.main' : 'text.secondary',
                      alignSelf: 'flex-start',
                      px: 0.5,
                    }}
                  >
                    {format(day, 'd')}
                  </Typography>
                  {dayRows.map((row) => (
                    <Chip
                      key={row.rowId}
                      size="small"
                      label={row.title?.trim() || 'Без названия'}
                      onClick={() => openRow(row.rowId)}
                      sx={{
                        justifyContent: 'flex-start',
                        maxWidth: '100%',
                        cursor: 'pointer',
                        '& .MuiChip-label': { px: 0.75 },
                      }}
                    />
                  ))}
                </Box>
              )
            })}
          </Box>

          {/* Undated strip */}
          {undated.length > 0 ? (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 1 }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                Без даты ({undated.length})
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {undated.map((row) => (
                  <Chip
                    key={row.rowId}
                    size="small"
                    label={row.title?.trim() || 'Без названия'}
                    onClick={() => openRow(row.rowId)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Box>
          ) : null}
        </Box>
      )}
    </Stack>
  )
}

/** Popover that writes `settings.layout.datePropertyId` from the DATE properties. */
function DatePropertyPicker({
  pageId,
  view,
  properties,
}: {
  pageId: string
  view: DatabaseSchema['views'][number]
  properties: DatabaseSchema['properties']
}) {
  const utils = trpc.useUtils()
  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])
  const dateProperties = useMemo(
    () => [...properties].filter((p) => p.type === 'DATE').sort((a, b) => a.position - b.position),
    [properties],
  )

  const updateView = trpc.database.updateView.useMutation({
    onSuccess: () => utils.database.getByPage.invalidate({ pageId }),
  })

  const NONE = '__none__'
  const selectedId = settings.layout?.datePropertyId ?? NONE

  function persist(propertyId: string) {
    const layout = { ...settings.layout }
    if (propertyId === NONE) delete layout.datePropertyId
    else layout.datePropertyId = propertyId
    updateView.mutate({ pageId, id: view.id, settings: { ...settings, layout } })
  }

  return (
    <Box sx={{ p: 1.5, width: 280 }}>
      <Typography variant="subtitle2" sx={{ px: 0.5 }}>
        Свойство даты
      </Typography>
      <Divider sx={{ my: 1 }} />
      {dateProperties.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
          Нет свойств типа «Дата». Добавьте свойство «Дата».
        </Typography>
      ) : (
        <Select
          size="small"
          fullWidth
          value={selectedId}
          onChange={(e) => persist(String(e.target.value))}
          sx={{ fontSize: 14 }}
          aria-label="Свойство даты"
        >
          <MenuItem value={NONE}>
            <em>Не выбрано</em>
          </MenuItem>
          {dateProperties.map((property) => (
            <MenuItem key={property.id} value={property.id}>
              {property.name}
            </MenuItem>
          ))}
        </Select>
      )}
    </Box>
  )
}
