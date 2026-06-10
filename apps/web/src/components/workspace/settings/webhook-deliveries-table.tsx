'use client'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { DELIVERY_STATUS_LABELS } from './webhook-events'

const SNIPPET_MAX_CHARS = 200

function truncate(text: string): string {
  return text.length > SNIPPET_MAX_CHARS ? `${text.slice(0, SNIPPET_MAX_CHARS)}…` : text
}

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function WebhookDeliveriesTable({
  workspaceId,
  subscriptionId,
}: {
  workspaceId: string
  subscriptionId: string
}) {
  const q = trpc.webhook.deliveries.useInfiniteQuery(
    { workspaceId, subscriptionId },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  )

  if (q.isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress size={20} />
      </Box>
    )
  }
  if (q.isError) {
    return <Alert severity="error">{q.error.message}</Alert>
  }

  const items = q.data.pages.flatMap((p) => p.items)
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        Доставок пока нет.
      </Typography>
    )
  }

  return (
    <Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Событие</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell align="right">Попытки</TableCell>
              <TableCell align="right">HTTP</TableCell>
              <TableCell align="right">Время</TableCell>
              <TableCell>Дата</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((d) => {
              const status = DELIVERY_STATUS_LABELS[d.status] ?? {
                label: d.status,
                color: 'default' as const,
              }
              const chip = <Chip size="small" label={status.label} color={status.color} />
              // The error if any, otherwise what the endpoint actually answered.
              const detail = d.lastError ?? (d.responseSnippet ? truncate(d.responseSnippet) : null)
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {d.eventType}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {detail ? (
                      <Tooltip title={detail}>
                        <span>{chip}</span>
                      </Tooltip>
                    ) : (
                      chip
                    )}
                  </TableCell>
                  <TableCell align="right">{d.attempts}</TableCell>
                  <TableCell align="right">{d.responseStatus ?? '—'}</TableCell>
                  <TableCell align="right">
                    {d.latencyMs !== null && d.latencyMs !== undefined ? `${d.latencyMs} мс` : '—'}
                  </TableCell>
                  <TableCell>{formatDate(d.createdAt)}</TableCell>
                </TableRow>
              )
            })}
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
    </Box>
  )
}
