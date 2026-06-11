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
  MenuItem,
  Select,
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
import { getPlanDisplayName } from '@/components/billing/plan-labels'

import {
  INVITABLE_ROLES,
  INVITE_STATE_CHIPS,
  MEMBER_ROLE_LABELS,
  SHARE_ROLE_LABELS,
  type InvitableRole,
} from './people-labels'

type Props = {
  workspaceId: string
  locked: boolean
}

type ConvertTarget = { userId: string; label: string }
type RevokeTarget = { userId: string; label: string }

/**
 * «Гости» — people with ≥1 page grant and no member row, plus pending page
 * guest invites. Conversion shows the billing-impact line before committing.
 */
export function GuestsList({ workspaceId, locked }: Props) {
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)
  const [convertTarget, setConvertTarget] = useState<ConvertTarget | null>(null)
  const [convertRole, setConvertRole] = useState<InvitableRole>('EDITOR')
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)

  const q = trpc.people.listGuests.useQuery({ workspaceId })
  // Same query key as the invite form — deduped by react-query.
  const previewQ = trpc.people.invitePreview.useQuery({ workspaceId })

  const onError = (e: { message: string }) => setError(e.message)
  const refresh = () => utils.people.listGuests.invalidate({ workspaceId })

  const convert = trpc.people.convertGuestToMember.useMutation({
    onSuccess: () => {
      setError(null)
      setConvertTarget(null)
      void Promise.all([
        refresh(),
        utils.workspace.listMembers.invalidate({ workspaceId }),
        utils.people.invitePreview.invalidate({ workspaceId }),
      ])
    },
    onError: (e) => {
      setConvertTarget(null)
      onError(e)
    },
  })
  const revokeAccess = trpc.people.revokeGuestAccess.useMutation({
    onSuccess: () => {
      setError(null)
      setRevokeTarget(null)
      void refresh()
    },
    onError: (e) => {
      setRevokeTarget(null)
      onError(e)
    },
  })
  // Pending page invites are revoked through the page-scoped procedure — the
  // invite row carries its pageId.
  const revokeInvite = trpc.page.share.revokeGuestInvite.useMutation({
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError,
  })

  const preview = previewQ.data ?? null

  return (
    <Box>
      <Typography variant="subtitle1">Гости</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Видят только страницы, к которым им явно дали доступ. Гости не занимают места тарифа.
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
      ) : (
        <>
          {q.data.guests.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Гостей пока нет.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Гость</TableCell>
                    <TableCell>Доступные страницы</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {q.data.guests.map((guest) => {
                    const label = guest.name || guest.email
                    return (
                      <TableRow key={guest.userId} data-testid="people-guest-row">
                        <TableCell>
                          {guest.name ?? guest.email}
                          {guest.name ? (
                            <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
                              {guest.email}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell>{guest.grantCount}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Button
                            size="small"
                            disabled={locked || convert.isPending}
                            onClick={() => {
                              setConvertRole('EDITOR')
                              setConvertTarget({ userId: guest.userId, label })
                            }}
                          >
                            Сделать участником
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            disabled={revokeAccess.isPending}
                            onClick={() => setRevokeTarget({ userId: guest.userId, label })}
                          >
                            Отозвать доступ
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {q.data.invites.length > 0 ? (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Ожидают приглашения к страницам
              </Typography>
              <Stack spacing={1}>
                {q.data.invites.map((invite) => {
                  const state = INVITE_STATE_CHIPS[invite.state] ?? {
                    label: invite.state,
                    color: 'default' as const,
                  }
                  return (
                    <Stack
                      key={invite.id}
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}
                    >
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                        {invite.email}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={SHARE_ROLE_LABELS[invite.role] ?? invite.role}
                      />
                      <Chip size="small" label={state.label} color={state.color} />
                      <Button
                        size="small"
                        color="error"
                        disabled={revokeInvite.isPending}
                        onClick={() => revokeInvite.mutate({ pageId: invite.pageId, id: invite.id })}
                      >
                        Отозвать
                      </Button>
                    </Stack>
                  )
                })}
              </Stack>
            </Box>
          ) : null}
        </>
      )}

      {convertTarget ? (
        <Dialog open onClose={() => setConvertTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Сделать участником?</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              {convertTarget.label} станет участником пространства и получит доступ ко всем
              командным разделам. Точечные доступы к страницам сохранятся.
            </DialogContentText>
            <Select
              size="small"
              fullWidth
              value={convertRole}
              onChange={(event) => setConvertRole(event.target.value as InvitableRole)}
            >
              {INVITABLE_ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {MEMBER_ROLE_LABELS[r]}
                </MenuItem>
              ))}
            </Select>
            {preview ? (
              <DialogContentText sx={{ mt: 2 }} variant="body2">
                Занято {preview.currentMembers} из {preview.maxMembers} мест тарифа{' '}
                {getPlanDisplayName({ slug: preview.planSlug })}. Участник займёт ещё одно место.
              </DialogContentText>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConvertTarget(null)}>Отмена</Button>
            <Button
              variant="contained"
              loading={convert.isPending}
              onClick={() =>
                convert.mutate({ workspaceId, userId: convertTarget.userId, role: convertRole })
              }
            >
              Сделать участником
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {revokeTarget ? (
        <Dialog open onClose={() => setRevokeTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Отозвать доступ гостя?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {revokeTarget.label} потеряет доступ ко всем страницам этого пространства, его
              ожидающие приглашения будут отозваны.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRevokeTarget(null)}>Отмена</Button>
            <Button
              color="error"
              variant="contained"
              loading={revokeAccess.isPending}
              onClick={() => revokeAccess.mutate({ workspaceId, userId: revokeTarget.userId })}
            >
              Отозвать доступ
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Box>
  )
}
