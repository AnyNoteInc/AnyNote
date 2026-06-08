'use client'

import { useMemo } from 'react'
import {
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'
import type { RouterOutputs } from '@/trpc/client'

type DatabaseViewModel = RouterOutputs['database']['getByPage']

interface DatabaseTableViewProps {
  readonly pageId: string
  readonly data: DatabaseViewModel
  readonly editable?: boolean
}

// C1 placeholder: a read-only table of the source view-model so the DATABASE
// renderer branch is exercisable end-to-end. C2 replaces this with the toolbar +
// inline cell editors + row/property management.
export function DatabaseTableView({ data }: DatabaseTableViewProps) {
  const properties = useMemo(
    () => [...data.properties].sort((a, b) => a.position - b.position),
    [data.properties],
  )
  const rows = useMemo(
    () => [...data.rows].sort((a, b) => a.position - b.position),
    [data.rows],
  )

  return (
    <Stack sx={{ height: '100%', minHeight: 0, bgcolor: 'background.paper' }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{data.systemTitleProperty.name}</TableCell>
                {properties.map((property) => (
                  <TableCell key={property.id} sx={{ fontWeight: 600 }}>
                    {property.name}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.rowId} hover>
                  <TableCell>{row.title ?? 'Без названия'}</TableCell>
                  {properties.map((property) => (
                    <TableCell key={property.id}>{String(row.cells[property.id] ?? '')}</TableCell>
                  ))}
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={properties.length + 1}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ py: 2, textAlign: 'center' }}
                    >
                      Пока нет строк
                    </Typography>
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
