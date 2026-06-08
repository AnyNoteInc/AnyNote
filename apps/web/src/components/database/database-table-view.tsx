'use client'

import { useMemo, useState } from 'react'
import {
  AddIcon,
  Box,
  Button,
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
import type { DatabaseViewModel } from './types'

interface DatabaseTableViewProps {
  readonly pageId: string
  readonly data: DatabaseViewModel
  readonly editable?: boolean
}

export function DatabaseTableView({ pageId, data, editable = true }: DatabaseTableViewProps) {
  const utils = trpc.useUtils()
  const [search, setSearch] = useState('')

  const properties = useMemo(
    () => [...data.properties].sort((a, b) => a.position - b.position),
    [data.properties],
  )

  // Database-local search: client-side filter over the already-loaded rows by
  // item title + stringified cell values (never global workspace search). Server
  // view filters supersede this for larger sets (Phase E); MVP filters in-memory.
  const rows = useMemo(() => {
    const sorted = [...data.rows].sort((a, b) => a.position - b.position)
    const q = search.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((row) => {
      if ((row.title ?? '').toLowerCase().includes(q)) return true
      return Object.values(row.cells).some((value) =>
        value != null && String(value).toLowerCase().includes(q),
      )
    })
  }, [data.rows, search])

  // Rows live in the listRows cache (Phase-4A fetch split); invalidate it so the
  // merged view-model in the renderer refetches.
  const invalidate = () => utils.database.listRows.invalidate({ pageId })
  const createRow = trpc.database.createRow.useMutation({ onSuccess: invalidate })
  const deleteRow = trpc.database.deleteRow.useMutation({ onSuccess: invalidate })

  const viewTitle = data.views[0]?.title ?? 'Таблица'
  const colCount = properties.length + 1 + (editable ? 1 : 0)

  return (
    <Stack sx={{ height: '100%', minHeight: 0, bgcolor: 'background.paper' }}>
      <DatabaseToolbar
        pageId={pageId}
        viewTitle={viewTitle}
        search={search}
        onSearchChange={setSearch}
        editable={editable}
      />

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 220, fontWeight: 600 }}>
                  {data.systemTitleProperty.name}
                </TableCell>
                {properties.map((property) => (
                  <TableCell key={property.id} sx={{ minWidth: 160 }}>
                    <PropertyHeaderCell pageId={pageId} property={property} editable={editable} />
                  </TableCell>
                ))}
                {editable ? <TableCell sx={{ width: 48 }} /> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.rowId} hover>
                  <TableCell sx={{ minWidth: 220 }}>
                    <RowTitleCell
                      pageId={pageId}
                      rowId={row.rowId}
                      title={row.title}
                      editable={editable}
                    />
                  </TableCell>
                  {properties.map((property) => (
                    <TableCell key={property.id} sx={{ minWidth: 160 }}>
                      <CellEditor pageId={pageId} row={row} property={property} editable={editable} />
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

              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                      {search.trim() ? 'Ничего не найдено' : 'Пока нет строк'}
                    </Typography>
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
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Stack>
  )
}
