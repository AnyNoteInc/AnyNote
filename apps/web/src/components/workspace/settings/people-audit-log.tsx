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

import { formatDateTime } from './people-labels'

// Russian labels for the people audit catalog. KEEP IN SYNC with
// PEOPLE_AUDIT_ACTIONS in packages/domain/src/people/dto/people.dto.ts
// (16 actions in Phase 8A); unknown actions fall back to the raw key.
const ACTION_LABELS: Record<string, string> = {
  'member.invited': 'Приглашение отправлено',
  'invite.revoked': 'Приглашение отозвано',
  'invite.accepted': 'Приглашение принято',
  'invite_link.enabled': 'Ссылка-приглашение включена',
  'invite_link.disabled': 'Ссылка-приглашение отключена',
  'invite_link.rotated': 'Ссылка-приглашение обновлена',
  'invite_link.joined': 'Вступление по ссылке-приглашению',
  'member.role_changed': 'Роль участника изменена',
  'member.removed': 'Участник удалён',
  'guest.invited': 'Гость приглашён к странице',
  'guest.invite_revoked': 'Приглашение гостя отозвано',
  'guest.joined': 'Гость принял приглашение',
  'guest.access_revoked': 'Доступ гостя отозван',
  'guest.converted_to_member': 'Гость стал участником',
  'user.blocked': 'Пользователь заблокирован',
  'user.unblocked': 'Пользователь разблокирован',
}

type Props = {
  workspaceId: string
}

/** «Журнал действий» — workspace audit log; the procedure is OWNER-only. */
export function PeopleAuditLog({ workspaceId }: Props) {
  const q = trpc.people.auditLog.useInfiniteQuery(
    { workspaceId },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  )

  return (
    <Box data-testid="people-audit">
      <Typography variant="subtitle1">Журнал действий</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Приглашения, роли, блокировки и доступы гостей — каждое действие фиксируется.
      </Typography>
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
                      <TableCell>Действие</TableCell>
                      <TableCell>Кто</TableCell>
                      <TableCell>Кого</TableCell>
                      <TableCell>Дата</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{ACTION_LABELS[row.action] ?? row.action}</TableCell>
                        <TableCell>{row.actorName ?? '—'}</TableCell>
                        <TableCell>{row.targetName ?? row.targetEmail ?? '—'}</TableCell>
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
  )
}
