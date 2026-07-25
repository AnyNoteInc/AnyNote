'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AddIcon,
  Box,
  Button,
  CircularProgress,
  DeleteIcon,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { ColumnResizeHandle } from './column-resize-handle'
import { DatabaseToolbar } from './database-toolbar'
import { PropertyHeaderCell } from './property-header-cell'
import { RowTitleCell } from './row-title-cell'
import { CellEditor } from './cell-editors/cell-dispatch'
import { useViewRows } from './use-view-rows'
import { parseViewSettings, TITLE_SENTINEL } from './types'
import type { DatabaseViewProps } from './types'

/** Lowercased, JSON-array-aware text of a cell value for the db-local search. */
function cellSearchText(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value))
    return value
      .map((v) => String(v))
      .join(' ')
      .toLowerCase()
  if (typeof value === 'object') return JSON.stringify(value).toLowerCase()
  return String(value).toLowerCase()
}

/**
 * TABLE layout. Fetches its own rows view-aware + paginated via `useViewRows`
 * (server-applied filters/sorts come baked in; the table only renders). Columns
 * respect `view.settings.visibleProperties` (null/absent = all visible). Cell and
 * title edits patch the active view's `listRows` cache (the renderer set the
 * active `viewId` in context). The db-local search filters only the currently
 * loaded page of rows; server-side filters (the toolbar's Фильтр popover)
 * supersede it for larger sets.
 */
export function DatabaseTableView({
  pageId,
  viewId,
  view,
  properties: allProperties,
  systemTitleProperty,
  editable,
  canEditStructure,
  myAccess,
}: DatabaseViewProps) {
  const utils = trpc.useUtils()
  const [search, setSearch] = useState('')

  const settings = useMemo(() => parseViewSettings(view.settings), [view.settings])

  // Column set: sorted by position, then filtered by `visibleProperties` (a view
  // display setting; null/absent → all columns). Never an ACL — hidden columns'
  // cells are still returned by the API.
  const properties = useMemo(() => {
    const sorted = [...allProperties].sort((a, b) => a.position - b.position)
    const visible = settings.visibleProperties
    if (!visible) return sorted
    const allowed = new Set(visible)
    return sorted.filter((p) => allowed.has(p.id))
  }, [allProperties, settings.visibleProperties])

  const { rows, fetchNextPage, hasNextPage, isLoading, isFetchingNextPage } = useViewRows(
    pageId,
    viewId,
  )

  // ── Column widths ───────────────────────────────────────────────────────────
  // Committed widths live in `view.settings.columnWidths` (px, keyed by
  // propertyId / TITLE_SENTINEL; absent = automatic). `draftWidths` holds the
  // full post-edit map through the persist round-trip (null = no pending edit);
  // once the refreshed settings land it clears.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [draftWidths, setDraftWidths] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    setDraftWidths(null)
  }, [view.settings])

  const widths = draftWidths ?? settings.columnWidths ?? {}

  const updateView = trpc.database.updateView.useMutation({
    onSuccess: () => utils.database.getByPage.invalidate({ pageId }),
  })

  const widthVar = (key: string) => `--db-col-${key}`

  // Live drag: the first frame flips a previously automatic column into fixed
  // mode via React (the cells need the fixed-width shape + the filler column);
  // every following frame streams through a CSS variable on the container —
  // zero React renders per frame (see the PanelResizeHandle guidance).
  function setLiveWidth(key: string, width: number) {
    if (widths[key] === undefined) {
      setDraftWidths({ ...widths, [key]: Math.round(width) })
      return
    }
    containerRef.current?.style.setProperty(widthVar(key), `${Math.round(width)}px`)
  }

  // null = drop the stored width (the column returns to automatic sizing).
  function persistWidth(key: string, width: number | null) {
    containerRef.current?.style.removeProperty(widthVar(key))
    const next = { ...widths }
    if (width === null) delete next[key]
    else next[key] = Math.round(width)
    setDraftWidths(next)
    updateView.mutate({ pageId, id: view.id, settings: { ...settings, columnWidths: next } })
  }

  // A fixed column pins width AND max-width (with hidden overflow) so header and
  // body stay aligned; an automatic column keeps the legacy min-width only. The
  // CSS variable lets a live drag move the whole column without re-rendering.
  function widthSx(key: string, autoMinWidth: number) {
    const width = widths[key]
    if (width === undefined) return { minWidth: autoMinWidth }
    const size = `var(${widthVar(key)}, ${width}px)`
    return { width: size, minWidth: size, maxWidth: size, overflow: 'hidden' }
  }

  // The table is width:100%, and in auto layout the browser hands surplus space
  // to EVERY column — a freshly fixed width would silently stretch back. A
  // trailing unconstrained filler column absorbs the surplus instead, so fixed
  // widths are honored. Rendered only when some column is fixed, keeping the
  // legacy stretch-to-fit look otherwise.
  const hasFixedColumns = [TITLE_SENTINEL, ...properties.map((p) => p.id)].some(
    (key) => widths[key] !== undefined,
  )

  // Server already filtered/sorted the page; the db-local search is a light
  // client filter over the loaded rows by title + stringified cell values.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      if ((row.title ?? '').toLowerCase().includes(q)) return true
      return Object.values(row.cells).some((value) => cellSearchText(value).includes(q))
    })
  }, [rows, search])

  // Row create/delete refetch the active view's rows (and sibling views, since a
  // new/removed row may match other filters).
  const invalidate = () => utils.database.listRows.invalidate({ pageId })
  const createRow = trpc.database.createRow.useMutation({ onSuccess: invalidate })
  const deleteRow = trpc.database.deleteRow.useMutation({ onSuccess: invalidate })

  const colCount = properties.length + 1 + (editable ? 1 : 0) + (hasFixedColumns ? 1 : 0)

  return (
    <Stack sx={{ flex: 1, minHeight: 0, bgcolor: 'background.paper' }}>
      <DatabaseToolbar
        pageId={pageId}
        view={view}
        properties={allProperties}
        systemTitleProperty={systemTitleProperty}
        search={search}
        onSearchChange={setSearch}
        editable={editable}
        canEditStructure={canEditStructure}
        myAccess={myAccess}
      />

      <Box ref={containerRef} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{ ...widthSx(TITLE_SENTINEL, 220), fontWeight: 600, position: 'relative' }}
                >
                  {systemTitleProperty.name}
                  {canEditStructure ? (
                    <ColumnResizeHandle
                      width={widths[TITLE_SENTINEL]}
                      onLiveWidth={(width) => setLiveWidth(TITLE_SENTINEL, width)}
                      onCommit={(width) => persistWidth(TITLE_SENTINEL, width)}
                      onReset={() => persistWidth(TITLE_SENTINEL, null)}
                      ariaLabel={`Изменить ширину столбца «${systemTitleProperty.name}»`}
                    />
                  ) : null}
                </TableCell>
                {properties.map((property) => (
                  <TableCell
                    key={property.id}
                    sx={{ ...widthSx(property.id, 160), position: 'relative' }}
                  >
                    <PropertyHeaderCell
                      pageId={pageId}
                      property={property}
                      editable={canEditStructure}
                      myAccess={myAccess}
                    />
                    {canEditStructure ? (
                      <ColumnResizeHandle
                        width={widths[property.id]}
                        onLiveWidth={(width) => setLiveWidth(property.id, width)}
                        onCommit={(width) => persistWidth(property.id, width)}
                        onReset={() => persistWidth(property.id, null)}
                        ariaLabel={`Изменить ширину столбца «${property.name}»`}
                      />
                    ) : null}
                  </TableCell>
                ))}
                {editable ? <TableCell sx={{ width: 48 }} /> : null}
                {hasFixedColumns ? <TableCell aria-hidden sx={{ p: 0 }} /> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.rowId} hover>
                  <TableCell sx={widthSx(TITLE_SENTINEL, 220)}>
                    <RowTitleCell
                      pageId={pageId}
                      viewId={viewId}
                      rowId={row.rowId}
                      title={row.title}
                      editable={editable}
                    />
                  </TableCell>
                  {properties.map((property) => (
                    <TableCell key={property.id} sx={widthSx(property.id, 160)}>
                      <CellEditor
                        pageId={pageId}
                        row={row}
                        property={property}
                        editable={editable}
                      />
                    </TableCell>
                  ))}
                  {editable ? (
                    <TableCell sx={{ width: 48 }}>
                      <IconButton
                        size="small"
                        aria-label="Удалить строку"
                        onClick={() => deleteRow.mutate({ pageId, rowId: row.rowId })}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  ) : null}
                  {hasFixedColumns ? <TableCell aria-hidden sx={{ p: 0 }} /> : null}
                </TableRow>
              ))}

              {visibleRows.length === 0 && !isLoading ? (
                <TableRow>
                  <TableCell colSpan={colCount}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ py: 2, textAlign: 'center' }}
                    >
                      {search.trim() ? 'Ничего не найдено' : 'Пока нет строк'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}

              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={colCount}>
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                      <CircularProgress size={20} />
                    </Box>
                  </TableCell>
                </TableRow>
              ) : null}

              {editable ? (
                <TableRow>
                  <TableCell colSpan={colCount} sx={{ borderBottom: 'none' }}>
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      disabled={createRow.isPending}
                      onClick={() => createRow.mutate({ pageId })}
                    >
                      Новая строка
                    </Button>
                  </TableCell>
                </TableRow>
              ) : null}

              {hasNextPage ? (
                <TableRow>
                  <TableCell colSpan={colCount} sx={{ borderBottom: 'none', textAlign: 'center' }}>
                    <Button
                      size="small"
                      disabled={isFetchingNextPage}
                      onClick={() => fetchNextPage()}
                    >
                      {isFetchingNextPage ? 'Загрузка…' : 'Загрузить ещё'}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Stack>
  )
}
