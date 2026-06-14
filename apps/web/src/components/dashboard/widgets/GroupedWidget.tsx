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

interface GroupedWidgetProps {
  readonly result: WidgetDataResult
}

function formatValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

/**
 * GROUPED widget — renders the `{status:'grouped'}` buckets as a compact
 * group→value table (the non-chart projection of the same data the bar/line/donut
 * charts plot). Non-data statuses degrade to the honest placeholder surfaces.
 */
export function GroupedWidget({ result }: GroupedWidgetProps) {
  if (result.status === 'no_access') return <WidgetNoAccess />
  if (result.status === 'hidden_property') return <WidgetHiddenProperty />
  if (result.status === 'error') return <WidgetError message={result.message} />
  if (result.status !== 'grouped') return <WidgetEmpty />
  if (result.groups.length === 0) return <WidgetEmpty />

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Группа</TableCell>
              <TableCell align="right">Значение</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.groups.map((g, i) => (
              <TableRow key={g.key ?? `__null_${i}`}>
                <TableCell>
                  <Typography variant="body2" noWrap>
                    {g.label || '—'}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatValue(g.value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {result.truncated ? <WidgetTruncatedNotice /> : null}
    </Box>
  )
}
