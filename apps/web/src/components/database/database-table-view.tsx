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
import { TextCell } from './cell-editors/text-cell'
import { NumberCell } from './cell-editors/number-cell'
import { CheckboxCell } from './cell-editors/checkbox-cell'
import { DateCell } from './cell-editors/date-cell'
import { SelectCell } from './cell-editors/select-cell'
import type { DatabasePropertyView, DatabaseRowView, DatabaseViewModel } from './types'

interface DatabaseTableViewProps {
  readonly pageId: string
  readonly data: DatabaseViewModel
  readonly editable?: boolean
}

/** Dispatch a cell to the editor for its property type. */
function CellEditor({
  pageId,
  row,
  property,
  editable,
}: {
  pageId: string
  row: DatabaseRowView
  property: DatabasePropertyView
  editable: boolean
}) {
  const value = row.cells[property.id]
  switch (property.type) {
    case 'NUMBER':
      return (
        <NumberCell pageId={pageId} rowId={row.rowId} propertyId={property.id} value={value} editable={editable} />
      )
    case 'CHECKBOX':
      return (
        <CheckboxCell pageId={pageId} rowId={row.rowId} propertyId={property.id} value={value} editable={editable} />
      )
    case 'DATE':
      return (
        <DateCell pageId={pageId} rowId={row.rowId} propertyId={property.id} value={value} editable={editable} />
      )
    case 'SELECT':
    case 'STATUS':
      return (
        <SelectCell pageId={pageId} rowId={row.rowId} property={property} value={value} editable={editable} />
      )
    case 'TEXT':
    case 'MULTI_SELECT':
    case 'PERSON':
    case 'FILE':
    default:
      return (
        <TextCell pageId={pageId} rowId={row.rowId} propertyId={property.id} value={value} editable={editable} />
      )
  }
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
  // `listRows({ query })` is also available for larger sets; MVP filters in-memory.
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

  const invalidate = () => utils.database.getByPage.invalidate({ pageId })
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
