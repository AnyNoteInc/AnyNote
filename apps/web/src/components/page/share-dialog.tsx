'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  AdapterDateFns,
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  DateTimePicker,
  dateFnsRu,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  LocalizationProvider,
  LockIcon,
  MenuItem,
  Paper,
  PersonAddIcon,
  PublicIcon,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PublishTab } from './publish-tab'
import { ShareStatusChips } from './share-status-chips'

type Props = {
  open: boolean
  onClose: () => void
  pageId: string
}

type ShareRole = 'READER' | 'COMMENTER' | 'EDITOR'

const ROLE_LABEL: Record<ShareRole, string> = {
  READER: 'Читатель',
  COMMENTER: 'Комментатор',
  EDITOR: 'Редактор',
}

type UserLite = { firstName: string | null; lastName: string | null; email: string }

function displayName(u: UserLite): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email
}

function initials(u: UserLite): string {
  return (u.firstName?.[0] ?? u.email[0] ?? '?').toUpperCase()
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function ShareDialog({ open, onClose, pageId }: Props) {
  const utils = trpc.useUtils()
  const shareQ = trpc.page.share.get.useQuery({ pageId }, { enabled: open })
  const invalidate = () => utils.page.share.get.invalidate({ pageId })
  const ensure = trpc.page.share.ensure.useMutation({ onSuccess: invalidate })
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'access' | 'publish'>('access')

  // Lazily materialise the share row the first time the dialog is opened.
  useEffect(() => {
    if (open && shareQ.data && shareQ.data.share === null && !ensure.isPending) {
      ensure.mutate({ pageId })
    }
  }, [open, shareQ.data, ensure, pageId])

  const searchQ = trpc.user.search.useQuery({ query }, { enabled: open && query.trim().length >= 3 })

  const addUser = trpc.page.share.addUser.useMutation({ onSuccess: invalidate })
  const updateUser = trpc.page.share.updateUser.useMutation({ onSuccess: invalidate })
  const removeUser = trpc.page.share.removeUser.useMutation({ onSuccess: invalidate })
  const setAccess = trpc.page.share.setAccess.useMutation({ onSuccess: invalidate })
  const updateLink = trpc.page.share.updatePublicLinkSettings.useMutation({ onSuccess: invalidate })

  // ── guest invites (people phase 8A): the EMAIL path for unregistered people ──
  const [guestEmail, setGuestEmail] = useState('')
  const [guestRole, setGuestRole] = useState<ShareRole>('READER')
  // Manage-rights gated server-side; non-managers simply see no list.
  const guestInvitesQ = trpc.page.share.listGuestInvites.useQuery(
    { pageId },
    { enabled: open, retry: false },
  )
  const invalidateGuestInvites = () => utils.page.share.listGuestInvites.invalidate({ pageId })
  const inviteGuest = trpc.page.share.inviteGuest.useMutation({
    onSuccess: () => {
      setGuestEmail('')
      invalidateGuestInvites()
    },
  })
  const revokeGuestInvite = trpc.page.share.revokeGuestInvite.useMutation({
    onSuccess: invalidateGuestInvites,
  })

  const data = shareQ.data?.share ?? null
  const owner = shareQ.data?.owner ?? null
  const grantedIds = useMemo(() => new Set((data?.users ?? []).map((u) => u.user.id)), [data])

  const shareUrl = data ? `${window.location.origin}/s/${data.shareId}` : ''

  async function copyLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (non-secure context / permission denied).
    }
  }

  const isPublic = data?.access === 'PUBLIC'

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>Общий доступ</DialogTitle>
      <DialogContent>
        {!data ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <ShareStatusChips share={data} />

            <Tabs
              value={tab}
              onChange={(_, next: 'access' | 'publish') => setTab(next)}
              sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}
            >
              <Tab value="access" label="Доступ" />
              <Tab value="publish" label="Публикация" />
            </Tabs>

            {tab === 'access' ? (
              <Stack spacing={2.5} sx={{ pt: 1 }}>
                {/* Search */}
                <Box sx={{ position: 'relative' }}>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Поиск пользователей по email или имени"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonAddIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                  {query.trim().length >= 3 && (searchQ.data ?? []).length > 0 && (
                    <Paper
                      sx={{
                        position: 'absolute',
                        zIndex: 10,
                        left: 0,
                        right: 0,
                        mt: 0.5,
                        maxHeight: 240,
                        overflow: 'auto',
                      }}
                    >
                      {(searchQ.data ?? [])
                        .filter((u) => !grantedIds.has(u.id))
                        .map((u) => (
                          <Box
                            key={u.id}
                            onClick={() => {
                              addUser.mutate({ pageId, userId: u.id, role: 'READER' })
                              setQuery('')
                            }}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                              px: 1.5,
                              py: 1,
                              cursor: 'pointer',
                              '&:hover': { bgcolor: 'action.hover' },
                            }}
                          >
                            <Avatar
                              src={u.image ?? undefined}
                              sx={{ width: 28, height: 28, fontSize: 13 }}
                            >
                              {initials(u)}
                            </Avatar>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" noWrap>
                                {displayName(u)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {u.email}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                    </Paper>
                  )}
                </Box>

                {/* Guest invite by email — works for unregistered addresses */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Пригласить по email
                  </Typography>
                  {inviteGuest.error ? (
                    <Alert severity="error" sx={{ mb: 1 }} onClose={() => inviteGuest.reset()}>
                      {inviteGuest.error.message}
                    </Alert>
                  ) : null}
                  {inviteGuest.isSuccess ? (
                    <Alert severity="success" sx={{ mb: 1 }} onClose={() => inviteGuest.reset()}>
                      Приглашение отправлено.
                    </Alert>
                  ) : null}
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="email@example.com"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      slotProps={{ htmlInput: { 'data-testid': 'share-guest-invite-email' } }}
                    />
                    <Select
                      size="small"
                      value={guestRole}
                      onChange={(e) => setGuestRole(e.target.value as ShareRole)}
                      sx={{ minWidth: 150 }}
                    >
                      {(['READER', 'COMMENTER', 'EDITOR'] as const).map((r) => (
                        <MenuItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </MenuItem>
                      ))}
                    </Select>
                    <Button
                      onClick={() =>
                        inviteGuest.mutate({ pageId, email: guestEmail.trim(), role: guestRole })
                      }
                      loading={inviteGuest.isPending}
                      disabled={!guestEmail.trim()}
                    >
                      Пригласить
                    </Button>
                  </Stack>
                  {(guestInvitesQ.data ?? []).length > 0 ? (
                    <Stack spacing={1} sx={{ mt: 1.5 }}>
                      {(guestInvitesQ.data ?? []).map((invite) => (
                        <Stack key={invite.id} direction="row" alignItems="center" spacing={1}>
                          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                            {invite.email}
                          </Typography>
                          <Chip size="small" variant="outlined" label={ROLE_LABEL[invite.role]} />
                          <Chip
                            size="small"
                            label={invite.state === 'PENDING' ? 'Ожидает' : 'Просрочено'}
                            color={invite.state === 'PENDING' ? 'default' : 'warning'}
                          />
                          <Button
                            size="small"
                            color="error"
                            disabled={revokeGuestInvite.isPending}
                            onClick={() => revokeGuestInvite.mutate({ pageId, id: invite.id })}
                          >
                            Отозвать
                          </Button>
                        </Stack>
                      ))}
                    </Stack>
                  ) : null}
                </Box>

                {/* People with access */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Пользователи, имеющие доступ
                  </Typography>
                  <Stack spacing={1}>
                    {owner && (
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Avatar
                          src={owner.image ?? undefined}
                          sx={{ width: 32, height: 32, fontSize: 14 }}
                        >
                          {initials(owner)}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {displayName(owner)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {owner.email}
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          Владелец
                        </Typography>
                      </Stack>
                    )}
                    {data.users.map((g) => (
                      <Stack key={g.user.id} direction="row" alignItems="center" spacing={1.5}>
                        <Avatar
                          src={g.user.image ?? undefined}
                          sx={{ width: 32, height: 32, fontSize: 14 }}
                        >
                          {initials(g.user)}
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {displayName(g.user)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {g.user.email}
                          </Typography>
                        </Box>
                        <Select
                          size="small"
                          value={g.role}
                          onChange={(e) =>
                            updateUser.mutate({
                              pageId,
                              userId: g.user.id,
                              role: e.target.value as ShareRole,
                            })
                          }
                          sx={{ minWidth: 140 }}
                        >
                          {(['READER', 'COMMENTER', 'EDITOR'] as const).map((r) => (
                            <MenuItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </MenuItem>
                          ))}
                        </Select>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => removeUser.mutate({ pageId, userId: g.user.id })}
                        >
                          Убрать
                        </Button>
                      </Stack>
                    ))}
                  </Stack>
                </Box>

                {/* General access */}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Общий доступ
                  </Typography>
                  <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                    <Box sx={{ pt: 1 }}>{isPublic ? <PublicIcon /> : <LockIcon />}</Box>
                    <Box sx={{ flex: 1 }}>
                      <Select
                        size="small"
                        fullWidth
                        value={data.access}
                        onChange={(e) =>
                          setAccess.mutate({
                            pageId,
                            access: e.target.value as 'RESTRICTED' | 'PUBLIC',
                            linkRole: data.linkRole,
                          })
                        }
                      >
                        <MenuItem value="RESTRICTED">Доступ ограничен</MenuItem>
                        <MenuItem value="PUBLIC">Всем, у кого есть ссылка</MenuItem>
                      </Select>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', mt: 0.5 }}
                      >
                        {isPublic
                          ? 'Просматривать могут все в интернете, у кого есть эта ссылка'
                          : 'Открывать контент по этой ссылке могут только пользователи, имеющие доступ'}
                      </Typography>
                      {isPublic && (
                        <Stack spacing={1.5} sx={{ mt: 1 }}>
                          <Select
                            size="small"
                            value={data.linkRole}
                            onChange={(e) =>
                              setAccess.mutate({
                                pageId,
                                access: 'PUBLIC',
                                linkRole: e.target.value as ShareRole,
                              })
                            }
                            sx={{ minWidth: 160 }}
                          >
                            {(['READER', 'COMMENTER', 'EDITOR'] as const).map((r) => (
                              <MenuItem key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </MenuItem>
                            ))}
                          </Select>
                          {/* Link expiration — Notion-parity "set an expiry". */}
                          <LocalizationProvider
                            dateAdapter={AdapterDateFns}
                            adapterLocale={dateFnsRu}
                          >
                            <DateTimePicker
                              label="Срок действия ссылки"
                              value={toDate(data.expiresAt)}
                              onChange={(d: Date | null) =>
                                updateLink.mutate({
                                  pageId,
                                  access: 'PUBLIC',
                                  linkRole: data.linkRole,
                                  expiresAt: d,
                                })
                              }
                              disablePast
                              localeText={{
                                cancelButtonLabel: 'Отмена',
                                okButtonLabel: 'Применить',
                              }}
                              slotProps={{
                                textField: { size: 'small', fullWidth: true },
                                actionBar: { actions: ['clear', 'cancel', 'accept'] },
                              }}
                            />
                          </LocalizationProvider>
                        </Stack>
                      )}
                    </Box>
                  </Stack>
                </Box>
              </Stack>
            ) : (
              <PublishTab pageId={pageId} share={data} onChanged={invalidate} />
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Button onClick={copyLink} disabled={!data}>
          {copied ? 'Скопировано' : 'Копировать ссылку'}
        </Button>
        <Button variant="contained" onClick={onClose}>
          Готово
        </Button>
      </DialogActions>
    </Dialog>
  )
}
