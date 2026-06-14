'use client'

import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import type { WidgetDataResult } from '@repo/domain'

import {
  WidgetEmpty,
  WidgetError,
  WidgetHiddenProperty,
  WidgetNoAccess,
  WidgetTruncatedNotice,
} from '../widget-data-states'

interface TableWidgetProps {
  readonly result: WidgetDataResult
}

/** Render an opaque cell value as read-only text (the same coercion the table embed uses). */
function cellText(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((v) => cellText(v)).join(', ')
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Common select/relation/user cell shapes carry a label/name/title.
    const label = obj.label ?? obj.name ?? obj.title ?? obj.value
    if (label != null && typeof label !== 'object') return String(label)
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  return String(value)
}

/**
 * TABLE widget — renders the per-widget `{status:'table'}` result (access- and
 * filter-respected rows + the visible properties) as a compact read-only table.
 * This reuses the SOURCE's access/visibility gate via the aggregation service
 * (the same authority `DatabaseTableView editable=false` would honor) rather than
 * re-mounting the full editable grid, so the widget stays read-only by
 * construction. Non-table/non-data statuses degrade to the placeholder surfaces.
 */
export function TableWidget({ result }: TableWidgetProps) {
  if (result.status === 'no_access') return <WidgetNoAccess />
  if (result.status === 'hidden_property') return <WidgetHiddenProperty />
  if (result.status === 'error') return <WidgetError message={result.message} />
  if (result.status !== 'table') return <WidgetEmpty />
  if (result.rows.length === 0) return <WidgetEmpty />

  const { rows, properties } = result

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Название</TableCell>
              {properties.map((p) => (
                <TableCell key={p.id}>{p.name}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rowId} hover>
                <TableCell>
                  <Typography variant="body2" noWrap sx={{ maxWidth: 240 }}>
                    {row.title || 'Без названия'}
                  </Typography>
                </TableCell>
                {properties.map((p) => (
                  <TableCell key={p.id}>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 240 }}>
                      {cellText(row.cells[p.id])}
                    </Typography>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {result.truncated ? <WidgetTruncatedNotice /> : null}
    </Box>
  )
}
