'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  LockIcon,
  MenuItem,
  Paper,
  PersonAddIcon,
  PublicIcon,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

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

export function ShareDialog({ open, onClose, pageId }: Props) {
  const utils = trpc.useUtils()
  const shareQ = trpc.page.share.get.useQuery({ pageId }, { enabled: open })
  const invalidate = () => utils.page.share.get.invalidate({ pageId })
  const ensure = trpc.page.share.ensure.useMutation({ onSuccess: invalidate })
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

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
      <DialogTitle>Общий доступ</DialogTitle>
      <DialogContent>
        {!data ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
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
                        <Avatar src={u.image ?? undefined} sx={{ width: 28, height: 28, fontSize: 13 }}>
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

            {/* People with access */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Пользователи, имеющие доступ
              </Typography>
              <Stack spacing={1}>
                {owner && (
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Avatar src={owner.image ?? undefined} sx={{ width: 32, height: 32, fontSize: 14 }}>
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
                    <Avatar src={g.user.image ?? undefined} sx={{ width: 32, height: 32, fontSize: 14 }}>
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
                        updateUser.mutate({ pageId, userId: g.user.id, role: e.target.value as ShareRole })
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
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {isPublic
                      ? 'Просматривать могут все в интернете, у кого есть эта ссылка'
                      : 'Открывать контент по этой ссылке могут только пользователи, имеющие доступ'}
                  </Typography>
                  {isPublic && (
                    <Select
                      size="small"
                      value={data.linkRole}
                      onChange={(e) =>
                        setAccess.mutate({ pageId, access: 'PUBLIC', linkRole: e.target.value as ShareRole })
                      }
                      sx={{ mt: 1, minWidth: 160 }}
                    >
                      {(['READER', 'COMMENTER', 'EDITOR'] as const).map((r) => (
                        <MenuItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                </Box>
              </Stack>
            </Box>
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
