'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  ContentCopyIcon,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { MEMBER_ROLE_LABELS } from './people-labels'

const LINK_ROLES = ['EDITOR', 'COMMENTER', 'VIEWER'] as const
type LinkRole = (typeof LINK_ROLES)[number]

type Props = {
  workspaceId: string
  locked: boolean
}

/**
 * «Ссылка-приглашение» — workspace join link. The plaintext URL crosses the
 * wire exactly once (enable/rotate responses); we keep it in local state until
 * the dialog closes. `get` never returns token material.
 */
export function InviteLinkCard({ workspaceId, locked }: Props) {
  const utils = trpc.useUtils()
  const q = trpc.people.inviteLink.get.useQuery({ workspaceId })
  const link = q.data ?? null

  const [roleOverride, setRoleOverride] = useState<LinkRole | null>(null)
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => utils.people.inviteLink.get.invalidate({ workspaceId })
  const onError = (e: { message: string }) => setError(e.message)
  const reveal = (url: string) => {
    setError(null)
    setRevealedUrl(url)
    setCopied(false)
    void invalidate()
  }

  const enable = trpc.people.inviteLink.enable.useMutation({
    onSuccess: (data) => reveal(data.url),
    onError,
  })
  const rotate = trpc.people.inviteLink.rotate.useMutation({
    onSuccess: (data) => reveal(data.url),
    onError,
  })
  const disable = trpc.people.inviteLink.disable.useMutation({
    onSuccess: () => {
      setError(null)
      setRevealedUrl(null)
      void invalidate()
    },
    onError,
  })

  const pending = enable.isPending || rotate.isPending || disable.isPending
  const enabled = link?.enabled ?? false
  // Stored link roles are EDITOR/COMMENTER/VIEWER by construction.
  const role: LinkRole = roleOverride ?? ((link?.role as LinkRole | undefined) ?? 'EDITOR')

  function setRole(next: LinkRole) {
    setRoleOverride(next)
    // Changing the role of an active link re-enables it: every enable issues a
    // FRESH token, so the old URL stops working and the new one is shown once.
    if (enabled) enable.mutate({ workspaceId, role: next })
  }

  async function copy() {
    if (!revealedUrl) return
    try {
      await navigator.clipboard.writeText(revealedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (non-secure context / permission denied).
    }
  }

  return (
    <Box>
      <Typography variant="subtitle1">Ссылка-приглашение</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Секретная ссылка для вступления в пространство без персонального приглашения.
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
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <FormControlLabel
              control={
                <Switch
                  data-testid="people-invite-link-toggle"
                  checked={enabled}
                  disabled={locked || pending}
                  onChange={(event) => {
                    if (event.target.checked) enable.mutate({ workspaceId, role })
                    else disable.mutate({ workspaceId })
                  }}
                />
              }
              label={enabled ? 'Ссылка активна' : 'Ссылка отключена'}
            />
            <Select
              size="small"
              value={role}
              disabled={locked || pending}
              onChange={(event) => setRole(event.target.value as LinkRole)}
              sx={{ minWidth: 160 }}
            >
              {LINK_ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {MEMBER_ROLE_LABELS[r]}
                </MenuItem>
              ))}
            </Select>
            {enabled ? (
              <Button
                size="small"
                onClick={() => rotate.mutate({ workspaceId })}
                loading={rotate.isPending}
                disabled={locked || disable.isPending || enable.isPending}
              >
                Обновить ссылку
              </Button>
            ) : null}
          </Stack>

          {enabled ? (
            <Alert severity="warning">Любой со ссылкой станет участником пространства.</Alert>
          ) : null}

          {enabled && revealedUrl ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                fullWidth
                value={revealedUrl}
                helperText="Ссылка показана один раз — скопируйте её сейчас. «Обновить ссылку» сделает старую недействительной."
                slotProps={{ htmlInput: { readOnly: true } }}
              />
              <Tooltip title={copied ? 'Скопировано' : 'Копировать'}>
                <IconButton aria-label="Копировать ссылку" onClick={copy} sx={{ mb: 2.5 }}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ) : enabled ? (
            <Typography variant="body2" color="text.secondary">
              Ссылка активна. Текст ссылки показывается только сразу после включения или
              обновления — нажмите «Обновить ссылку», чтобы получить новую.
            </Typography>
          ) : null}
        </Stack>
      )}
    </Box>
  )
}
