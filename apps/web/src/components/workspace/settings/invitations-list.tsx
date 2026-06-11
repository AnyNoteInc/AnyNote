'use client'

import { useState } from 'react'

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
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import {
  INVITE_STATE_CHIPS,
  MEMBER_ROLE_LABELS,
  formatDateTime,
  type InvitableRole,
} from './people-labels'

type Props = {
  workspaceId: string
  locked: boolean
}

/** «Приглашения» — open (pending/expired) member invitations with revoke / re-send. */
export function InvitationsList({ workspaceId, locked }: Props) {
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)
  const q = trpc.people.listInvitations.useQuery({ workspaceId })

  const refresh = () =>
    Promise.all([
      utils.people.listInvitations.invalidate({ workspaceId }),
      utils.people.invitePreview.invalidate({ workspaceId }),
    ])
  const onError = (e: { message: string }) => setError(e.message)

  // «Отправить снова» IS people.invite: re-inviting an active email refreshes
  // the row (fresh token + TTL) and re-sends the mail.
  const resend = trpc.people.invite.useMutation({
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError,
  })
  const revoke = trpc.people.revokeInvitation.useMutation({
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError,
  })

  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Приглашения
      </Typography>
      {error ? (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>
          {error}
        </Alert>
      ) : null}
      {q.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : q.isError ? (
        <Alert severity="error">{q.error.message}</Alert>
      ) : q.data.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Открытых приглашений нет.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Email</TableCell>
                <TableCell>Роль</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Истекает</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {q.data.map((invitation) => {
                const state = INVITE_STATE_CHIPS[invitation.state] ?? {
                  label: invitation.state,
                  color: 'default' as const,
                }
                return (
                  <TableRow key={invitation.id} data-testid="people-invitation-row">
                    <TableCell>{invitation.email}</TableCell>
                    <TableCell>{MEMBER_ROLE_LABELS[invitation.role] ?? invitation.role}</TableCell>
                    <TableCell>
                      <Chip size="small" label={state.label} color={state.color} />
                    </TableCell>
                    <TableCell>{formatDateTime(invitation.expiresAt)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Button
                        size="small"
                        disabled={locked || resend.isPending}
                        onClick={() =>
                          resend.mutate({
                            workspaceId,
                            email: invitation.email,
                            // Open invitations only ever carry invitable roles.
                            role: invitation.role as InvitableRole,
                          })
                        }
                      >
                        Отправить снова
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={revoke.isPending}
                        onClick={() =>
                          revoke.mutate({ workspaceId, invitationId: invitation.id })
                        }
                      >
                        Отозвать
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
