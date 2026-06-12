'use client'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'
import { formatDateTime } from './people-labels'
import { SEAT_EVENT_LABELS, formatKopecks } from './billing-labels'

type Props = {
  workspaceId: string
}

/** «Журнал мест» — the append-only seat ledger; keyset 30 (the people-audit-log pattern). */
export function SeatEventsTable({ workspaceId }: Props) {
  const q = trpc.billing.seatEvents.useInfiniteQuery(
    { workspaceId },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  )

  return (
    <SettingsCard
      title="Журнал мест"
      description="Покупки, продления, сокращения и движение участников по местам — каждый шаг фиксируется."
    >
      <Box data-testid="billing-seat-events">
        {q.isPending ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={20} />
          </Box>
        ) : q.isError ? (
          <Alert severity="error">{q.error.message}</Alert>
        ) : (
          (() => {
            const items = q.data.pages.flatMap((page) => page.items)
            if (items.length === 0) {
              return (
                <Typography variant="body2" color="text.secondary">
                  Записей пока нет.
                </Typography>
              )
            }
            return (
              <>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Событие</TableCell>
                        <TableCell>Участник</TableCell>
                        <TableCell>Изменение</TableCell>
                        <TableCell>Сумма</TableCell>
                        <TableCell>Дата</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {items.map((row) => (
                        <TableRow key={row.id} data-testid="billing-seat-event-row">
                          <TableCell>
                            <Typography variant="body2">
                              {SEAT_EVENT_LABELS[row.type] ?? row.type}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {row.actorName ?? 'Система'}
                            </Typography>
                          </TableCell>
                          <TableCell>{row.targetName ?? '—'}</TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {row.seatsDelta > 0 ? `+${row.seatsDelta}` : row.seatsDelta}
                            {row.seatsAfter !== null ? ` → ${row.seatsAfter}` : ''}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {row.amountKopecks !== null ? formatKopecks(row.amountKopecks) : '—'}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {formatDateTime(row.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {q.hasNextPage ? (
                  <Button
                    size="small"
                    onClick={() => q.fetchNextPage()}
                    loading={q.isFetchingNextPage}
                    sx={{ mt: 1 }}
                  >
                    Показать ещё
                  </Button>
                ) : null}
              </>
            )
          })()
        )}
      </Box>
    </SettingsCard>
  )
}
