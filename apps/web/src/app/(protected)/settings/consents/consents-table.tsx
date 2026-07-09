'use client'

import Link from 'next/link'

import {
  Box,
  Chip,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

export type ConsentsTableRow = {
  documentType: string
  title: string
  url: string
  required: boolean
  granted: boolean
  grantedAt: Date | null
}

const formatDate = (d: Date | null): string => {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

export function ConsentsTable({ rows }: Readonly<{ rows: readonly ConsentsTableRow[] }>) {
  const utils = trpc.useUtils()
  const setMarketing = trpc.consent.setMarketing.useMutation({
    onSuccess: () => utils.consent.list.invalidate(),
  })

  return (
    <TableContainer
      component={Box}
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
    >
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Документ</TableCell>
            <TableCell>Статус</TableCell>
            <TableCell>Дата</TableCell>
            <TableCell align="right">Действие</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.documentType}>
              <TableCell>
                <Stack spacing={0.25}>
                  <Typography variant="body2">{row.title}</Typography>
                  {row.required ? (
                    <Typography variant="caption" color="text.secondary">
                      Обязательно
                    </Typography>
                  ) : null}
                </Stack>
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  color={row.granted ? 'success' : 'default'}
                  label={row.granted ? 'Принято' : 'Отклонено'}
                />
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">
                  {formatDate(row.grantedAt)}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'flex-end' }}
                >
                  {row.documentType === 'MARKETING' ? (
                    <Switch
                      size="small"
                      checked={row.granted}
                      onChange={(e) => setMarketing.mutate({ granted: e.target.checked })}
                      disabled={setMarketing.isPending}
                      slotProps={{ input: { 'aria-label': 'Маркетинговые рассылки' } }}
                    />
                  ) : null}
                  <Box
                    component={Link}
                    href={row.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color: 'primary.main',
                      textDecoration: 'none',
                      fontSize: 14,
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    Открыть
                  </Box>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
