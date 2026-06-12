'use client'

import { useState } from 'react'

import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { getPlanDisplayName } from '@/components/billing/plan-labels'

import { SettingsCard } from './settings-card'
import { InvitationsList } from './invitations-list'
import { InviteLinkCard } from './invite-link-card'
import { GuestsList } from './guests-list'
import { PeopleAuditLog } from './people-audit-log'
import {
  INVITABLE_ROLES,
  MEMBER_ROLE_LABELS,
  type InvitableRole,
} from './people-labels'

type Props = {
  workspaceId: string
  locked: boolean
  currentUserId: string
  /** OWNER sees the audit log and may grant/touch OWNER rows; ADMIN may not. */
  isOwner: boolean
}

type Notice = { severity: 'error' | 'success'; text: string }
type ConfirmAction = { kind: 'remove' | 'block'; userId: string; label: string }

/** A role-change target the server accepts (`roleChangeSchema`) — never GUEST. */
type ChangeableRole = 'OWNER' | InvitableRole

export function WorkspaceMembersSection({ workspaceId, locked, currentUserId, isOwner }: Props) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('EDITOR')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  const utils = trpc.useUtils()
  const members = trpc.workspace.listMembers.useQuery({ workspaceId })
  const blockedQ = trpc.people.listBlocked.useQuery({ workspaceId })
  const previewQ = trpc.people.invitePreview.useQuery({ workspaceId })

  const onError = (e: { message: string }) => setNotice({ severity: 'error', text: e.message })
  const refreshMembers = () =>
    Promise.all([
      utils.workspace.listMembers.invalidate({ workspaceId }),
      utils.people.invitePreview.invalidate({ workspaceId }),
    ])

  const invite = trpc.people.invite.useMutation({
    onSuccess: () => {
      setEmail('')
      setNotice({ severity: 'success', text: 'Приглашение отправлено.' })
      void Promise.all([
        utils.people.listInvitations.invalidate({ workspaceId }),
        utils.people.invitePreview.invalidate({ workspaceId }),
      ])
    },
    onError,
  })
  const changeRole = trpc.people.changeMemberRole.useMutation({
    onSuccess: () => {
      setNotice(null)
      void refreshMembers()
    },
    onError,
  })
  const remove = trpc.people.removeMember.useMutation({
    onSuccess: () => {
      setNotice(null)
      setConfirm(null)
      // An ex-member who still holds page grants reappears as a guest.
      void Promise.all([refreshMembers(), utils.people.listGuests.invalidate({ workspaceId })])
    },
    onError: (e) => {
      setConfirm(null)
      onError(e)
    },
  })
  const block = trpc.people.block.useMutation({
    onSuccess: () => {
      setNotice(null)
      setConfirm(null)
      void utils.people.listBlocked.invalidate({ workspaceId })
    },
    onError: (e) => {
      setConfirm(null)
      onError(e)
    },
  })
  const unblock = trpc.people.unblock.useMutation({
    onSuccess: () => {
      setNotice(null)
      void utils.people.listBlocked.invalidate({ workspaceId })
    },
    onError,
  })

  const blockedIds = new Set((blockedQ.data ?? []).map((b) => b.userId))
  const preview = previewQ.data ?? null
  // ADMIN can grant any non-OWNER role; only an OWNER can grant OWNER.
  const assignableRoles: ChangeableRole[] = isOwner ? ['OWNER', ...INVITABLE_ROLES] : [...INVITABLE_ROLES]

  return (
    <SettingsCard
      title="Участники"
      description="Приглашайте людей, управляйте ролями, блокировками и гостевыми доступами."
    >
      {locked ? (
        <Alert severity="info">
          Приглашения доступны на платных тарифах. <a href="/settings/billing">Апгрейд</a>
        </Alert>
      ) : null}
      {notice ? (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      ) : null}

      {/* ── invite form ──────────────────────────────────────────────────── */}
      <Box>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={locked || invite.isPending}
            size="small"
            sx={{ flex: 1 }}
            slotProps={{ htmlInput: { 'data-testid': 'people-invite-email' } }}
          />
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as InvitableRole)}
            disabled={locked || invite.isPending}
            size="small"
            sx={{ minWidth: 160 }}
          >
            {INVITABLE_ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {MEMBER_ROLE_LABELS[r]}
              </MenuItem>
            ))}
          </Select>
          <Button
            data-testid="people-invite-submit"
            onClick={() => invite.mutate({ workspaceId, email, role })}
            loading={invite.isPending}
            disabled={locked || !email}
          >
            Пригласить
          </Button>
        </Stack>
        {preview ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Занято {preview.currentMembers} из {preview.maxMembers} мест тарифа{' '}
            {getPlanDisplayName({ slug: preview.planSlug })}.
          </Typography>
        ) : null}
      </Box>

      {/* ── members table ────────────────────────────────────────────────── */}
      {members.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : members.isError ? (
        <Alert severity="error">{members.error.message}</Alert>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Участник</TableCell>
                <TableCell>Роль</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {members.data.map((member) => {
                const isSelf = member.userId === currentUserId
                const isOwnerRow = member.role === 'OWNER'
                const isBlocked = blockedIds.has(member.userId)
                const label =
                  `${member.user.firstName ?? ''} ${member.user.lastName ?? ''}`.trim() ||
                  member.user.email
                // ADMIN actors see OWNER rows locked; the frozen legacy GUEST
                // role may be upgraded but never assigned.
                const roleLocked = locked || (isOwnerRow && !isOwner)
                const rowRoles: ChangeableRole[] =
                  isOwnerRow && !isOwner ? ['OWNER'] : assignableRoles
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Avatar
                          src={member.user.image ?? undefined}
                          sx={{ width: 28, height: 28, fontSize: 13 }}
                        >
                          {(member.user.firstName?.[0] ?? member.user.email[0] ?? '?').toUpperCase()}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          {/* Chip renders a <div> — keep it a SIBLING of the
                              Typography (<p>), never a child: div-in-p is
                              invalid DOM nesting and breaks hydration. */}
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                              {label}
                            </Typography>
                            {isBlocked ? (
                              <Chip
                                size="small"
                                color="error"
                                variant="outlined"
                                label="Заблокирован"
                              />
                            ) : null}
                          </Stack>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {member.user.email}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Select
                        size="small"
                        value={member.role}
                        disabled={roleLocked || changeRole.isPending}
                        onChange={(event) =>
                          changeRole.mutate({
                            workspaceId,
                            userId: member.userId,
                            role: event.target.value as ChangeableRole,
                          })
                        }
                        sx={{ minWidth: 170 }}
                      >
                        {member.role === 'GUEST' ? (
                          <MenuItem value="GUEST" disabled>
                            {MEMBER_ROLE_LABELS.GUEST}
                          </MenuItem>
                        ) : null}
                        {rowRoles.map((r) => (
                          <MenuItem key={r} value={r}>
                            {MEMBER_ROLE_LABELS[r]}
                          </MenuItem>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {!isSelf && !isOwnerRow ? (
                        isBlocked ? (
                          <Button
                            size="small"
                            data-testid="people-unblock-button"
                            disabled={unblock.isPending}
                            onClick={() => unblock.mutate({ workspaceId, userId: member.userId })}
                          >
                            Разблокировать
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            color="warning"
                            data-testid="people-block-button"
                            disabled={block.isPending}
                            onClick={() =>
                              setConfirm({ kind: 'block', userId: member.userId, label })
                            }
                          >
                            Заблокировать
                          </Button>
                        )
                      ) : null}
                      {!isSelf ? (
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          disabled={remove.isPending || (isOwnerRow && !isOwner)}
                          onClick={() =>
                            setConfirm({ kind: 'remove', userId: member.userId, label })
                          }
                        >
                          Удалить
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Divider />
      <InvitationsList workspaceId={workspaceId} locked={locked} />

      <Divider />
      <InviteLinkCard workspaceId={workspaceId} locked={locked} />

      <Divider />
      <GuestsList workspaceId={workspaceId} locked={locked} />

      {isOwner ? (
        <>
          <Divider />
          <PeopleAuditLog workspaceId={workspaceId} />
        </>
      ) : null}

      {confirm ? (
        <Dialog open onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
          <DialogTitle>
            {confirm.kind === 'remove' ? 'Удалить участника?' : 'Заблокировать участника?'}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {confirm.kind === 'remove'
                ? `${confirm.label} потеряет доступ к пространству. Если у него останутся точечные доступы к страницам, он появится в списке «Гости».`
                : `${confirm.label} мгновенно потеряет доступ ко всем данным пространства — включая страницы, к которым ему давали гостевой доступ. Блокировку можно снять.`}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(null)}>Отмена</Button>
            <Button
              color={confirm.kind === 'remove' ? 'error' : 'warning'}
              variant="contained"
              loading={remove.isPending || block.isPending}
              onClick={() => {
                if (confirm.kind === 'remove') {
                  remove.mutate({ workspaceId, userId: confirm.userId })
                } else {
                  block.mutate({ workspaceId, userId: confirm.userId })
                }
              }}
            >
              {confirm.kind === 'remove' ? 'Удалить' : 'Заблокировать'}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </SettingsCard>
  )
}
