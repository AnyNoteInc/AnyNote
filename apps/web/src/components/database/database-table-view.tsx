'use client'

import { useMemo, useState } from 'react'
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

import { DatabaseToolbar } from './database-toolbar'
import { PropertyHeaderCell } from './property-header-cell'
import { RowTitleCell } from './row-title-cell'
import { CellEditor } from './cell-editors/cell-dispatch'
import { useViewRows } from './use-view-rows'
import { parseViewSettings } from './types'
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

  const colCount = properties.length + 1 + (editable ? 1 : 0)

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

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 220, fontWeight: 600 }}>
                  {systemTitleProperty.name}
                </TableCell>
                {properties.map((property) => (
                  <TableCell key={property.id} sx={{ minWidth: 160 }}>
                    <PropertyHeaderCell
                      pageId={pageId}
                      property={property}
                      editable={canEditStructure}
                      myAccess={myAccess}
                    />
                  </TableCell>
                ))}
                {editable ? <TableCell sx={{ width: 48 }} /> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.rowId} hover>
                  <TableCell sx={{ minWidth: 220 }}>
                    <RowTitleCell
                      pageId={pageId}
                      viewId={viewId}
                      rowId={row.rowId}
                      title={row.title}
                      editable={editable}
                    />
                  </TableCell>
                  {properties.map((property) => (
                    <TableCell key={property.id} sx={{ minWidth: 160 }}>
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
