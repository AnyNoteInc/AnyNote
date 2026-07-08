'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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

import { SettingsCard } from './settings-card'
import { SHARE_ROLE_LABELS, formatDateTime, type ChipColor } from './people-labels'

type Props = {
  workspaceId: string
}

const STATUS_CHIPS: Record<string, { label: string; color: ChipColor }> = {
  PENDING: { label: 'Ожидает', color: 'warning' },
  APPROVED: { label: 'Одобрен', color: 'success' },
  REJECTED: { label: 'Отклонён', color: 'default' },
}

type ConfirmAction = { kind: 'approve' | 'reject'; id: string; email: string }

/**
 * «Запросы на гостевой доступ» (8C spec §6) — the OWNER queue. PENDING first
 * (server-sorted); approve creates the real guest invite and sends the usual
 * invitation mail, reject just closes the request (the requester is not
 * notified — there is no requester-facing notification in 8C).
 */
export function GuestRequestsCard({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  const listQ = trpc.security.listGuestRequests.useQuery({ workspaceId })
  const settle = {
    onSuccess: () => {
      setError(null)
      setConfirm(null)
      void utils.security.listGuestRequests.invalidate({ workspaceId })
    },
    onError: (e: { message: string }) => {
      setConfirm(null)
      setError(e.message)
    },
  }
  const approve = trpc.security.approveGuestRequest.useMutation(settle)
  const reject = trpc.security.rejectGuestRequest.useMutation(settle)

  return (
    <SettingsCard
      title="Запросы на гостевой доступ"
      description="Очередь запросов от участников, когда гостевые приглашения отключены политикой. Одобрение отправляет гостю обычное приглашение по email."
    >
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {listQ.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : listQ.isError ? (
        <Alert severity="error">{listQ.error.message}</Alert>
      ) : listQ.data.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Запросов пока нет.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Запросил</TableCell>
                <TableCell>Страница</TableCell>
                <TableCell>Гость</TableCell>
                <TableCell>Роль</TableCell>
                <TableCell>Дата</TableCell>
                <TableCell align="right">Статус</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {listQ.data.map((row) => {
                const status = STATUS_CHIPS[row.status] ?? {
                  label: row.status,
                  color: 'default' as ChipColor,
                }
                return (
                  <TableRow key={row.id} data-testid="guest-request-row">
                    <TableCell>
                      {/* requesterEmail === null ⇔ the user row is gone. */}
                      {row.requesterEmail === null ? (
                        <Typography variant="body2" color="text.secondary">
                          Пользователь удалён
                        </Typography>
                      ) : (
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {row.requesterName ?? row.requesterEmail}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {row.requesterEmail}
                          </Typography>
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>{row.pageTitle ?? 'Без названия'}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>{SHARE_ROLE_LABELS[row.role] ?? row.role}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {row.status === 'PENDING' ? (
                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                          <Button
                            size="small"
                            data-testid="guest-request-approve"
                            disabled={approve.isPending || reject.isPending}
                            onClick={() =>
                              setConfirm({ kind: 'approve', id: row.id, email: row.email })
                            }
                          >
                            Одобрить
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            disabled={approve.isPending || reject.isPending}
                            onClick={() =>
                              setConfirm({ kind: 'reject', id: row.id, email: row.email })
                            }
                          >
                            Отклонить
                          </Button>
                        </Stack>
                      ) : (
                        <Chip size="small" color={status.color} label={status.label} />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {confirm ? (
        <Dialog open onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
          <DialogTitle>
            {confirm.kind === 'approve' ? 'Одобрить запрос?' : 'Отклонить запрос?'}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {confirm.kind === 'approve'
                ? `${confirm.email} получит приглашение по email и после принятия — гостевой доступ к странице.`
                : `Запрос для ${confirm.email} будет отклонён. Приглашение не отправится; запросивший не получит уведомления.`}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(null)}>Отмена</Button>
            <Button
              variant="contained"
              color={confirm.kind === 'approve' ? 'primary' : 'error'}
              loading={approve.isPending || reject.isPending}
              onClick={() => {
                if (confirm.kind === 'approve') {
                  approve.mutate({ workspaceId, id: confirm.id })
                } else {
                  reject.mutate({ workspaceId, id: confirm.id })
                }
              }}
            >
              {confirm.kind === 'approve' ? 'Одобрить' : 'Отклонить'}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </SettingsCard>
  )
}
