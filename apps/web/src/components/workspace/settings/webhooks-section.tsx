'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  ContentCopyIcon,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ExpandMoreIcon,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'
import { WebhookCreateDialog } from './webhook-dialog'
import { WebhookDeliveriesTable } from './webhook-deliveries-table'
import { WEBHOOK_STATUS_LABELS } from './webhook-events'

type Notice = { severity: 'error' | 'info' | 'success'; text: string }
type SecretDialogState = { secret: string; mode: 'created' | 'rotated' }

const SECRET_DOC =
  'Секрет показывается только один раз. Подпись: X-AnyNote-Signature = sha256=HMAC_SHA256(secret, timestamp + "." + body)'

export function WorkspaceWebhooksSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const utils = trpc.useUtils()
  // The router restricts every webhook procedure (incl. list) to OWNER/ADMIN,
  // so the query only runs for managers — others see the info alert below.
  const list = trpc.webhook.list.useQuery({ workspaceId }, { enabled: canManage })
  const invalidate = () => utils.webhook.list.invalidate({ workspaceId })

  const [notice, setNotice] = useState<Notice | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [secretDialog, setSecretDialog] = useState<SecretDialogState | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const onError = (e: { message: string }) => setNotice({ severity: 'error', text: e.message })

  const verify = trpc.webhook.verify.useMutation({
    onSuccess: (data) => {
      invalidate()
      setNotice(
        data.status === 'ACTIVE'
          ? { severity: 'success', text: 'Адрес подтверждён — вебхук активен.' }
          : {
              severity: 'info',
              text: 'Конечная точка не ответила на проверочный запрос. Проверьте URL и повторите.',
            },
      )
    },
    onError,
  })
  const setEnabled = trpc.webhook.setEnabled.useMutation({
    onSuccess: () => {
      invalidate()
      setNotice(null)
    },
    onError,
  })
  const rotate = trpc.webhook.rotateSecret.useMutation({
    onSuccess: (data) => {
      setNotice(null)
      setSecretDialog({ secret: data.secret, mode: 'rotated' })
    },
    onError,
  })
  const del = trpc.webhook.delete.useMutation({
    onSuccess: () => {
      invalidate()
      setNotice(null)
    },
    onError,
  })

  return (
    <SettingsCard
      title="Вебхуки"
      description="HTTP-уведомления о событиях пространства для ваших интеграций. Подпись HMAC, повторные попытки и журнал доставок."
    >
      {!canManage ? (
        <Alert severity="info">Управлять вебхуками могут владелец и администраторы.</Alert>
      ) : null}
      {notice ? (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      ) : null}
      {canManage && list.isError ? <Alert severity="error">{list.error.message}</Alert> : null}
      {canManage && list.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : null}
      {canManage && list.data?.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Пока нет ни одной подписки. Добавьте вебхук, чтобы получать события пространства.
        </Typography>
      ) : null}

      {list.data?.map((s) => {
        const status = WEBHOOK_STATUS_LABELS[s.status] ?? {
          label: s.status,
          color: 'default' as const,
        }
        const expanded = expandedId === s.id
        const active = s.status === 'ACTIVE'
        // Resume requires a verified address (the router rejects it otherwise) —
        // PENDING and never-verified subscriptions can only be re-verified.
        const resumeBlocked = !active && (s.status === 'PENDING' || !s.verifiedAt)
        const switchLabel = resumeBlocked
          ? 'Сначала подтвердите адрес'
          : active
            ? 'Приостановить'
            : 'Возобновить'
        return (
          <Box
            key={s.id}
            data-testid="webhook-row"
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
                  <Typography variant="subtitle2">{s.name}</Typography>
                  <Chip size="small" label={status.label} color={status.color} />
                  <Chip size="small" variant="outlined" label={`Событий: ${s.events.length}`} />
                  {s.consecutiveFailures > 0 ? (
                    <Chip
                      size="small"
                      color="warning"
                      label={`Сбоев подряд: ${s.consecutiveFailures}`}
                    />
                  ) : null}
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: 'block', maxWidth: 420 }}
                >
                  {s.url}
                </Typography>
              </Box>
              {canManage ? (
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, alignItems: 'center' }}>
                  {s.status === 'PENDING' ? (
                    <Button
                      size="small"
                      data-testid="webhook-verify"
                      onClick={() => verify.mutate({ id: s.id, workspaceId })}
                      loading={verify.isPending && verify.variables?.id === s.id}
                    >
                      Проверить
                    </Button>
                  ) : null}
                  <Tooltip title={switchLabel}>
                    {/* span: tooltips don't fire on disabled controls */}
                    <span>
                      <Switch
                        size="small"
                        checked={active}
                        disabled={setEnabled.isPending || resumeBlocked}
                        onChange={(_, v) =>
                          setEnabled.mutate({ id: s.id, workspaceId, enabled: v })
                        }
                        slotProps={{ input: { 'aria-label': switchLabel } }}
                      />
                    </span>
                  </Tooltip>
                  <Button
                    size="small"
                    onClick={() => rotate.mutate({ id: s.id, workspaceId })}
                    loading={rotate.isPending && rotate.variables?.id === s.id}
                  >
                    Сменить секрет
                  </Button>
                  <IconButton
                    size="small"
                    aria-label="Удалить вебхук"
                    onClick={() => del.mutate({ id: s.id, workspaceId })}
                    disabled={del.isPending}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ) : null}
            </Stack>
            <Button
              size="small"
              data-testid="webhook-deliveries"
              onClick={() => setExpandedId(expanded ? null : s.id)}
              endIcon={
                <ExpandMoreIcon
                  sx={{
                    transform: expanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                  }}
                />
              }
              sx={{ mt: 0.5 }}
            >
              Доставки
            </Button>
            <Collapse in={expanded} mountOnEnter unmountOnExit>
              <WebhookDeliveriesTable workspaceId={workspaceId} subscriptionId={s.id} />
            </Collapse>
          </Box>
        )
      })}

      {canManage ? (
        <Button
          variant="outlined"
          data-testid="webhooks-create"
          onClick={() => setCreateOpen(true)}
          sx={{ alignSelf: 'flex-start' }}
        >
          Добавить вебхук
        </Button>
      ) : null}

      {createOpen ? (
        <WebhookCreateDialog
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={(secret) => {
            setCreateOpen(false)
            setSecretDialog({ secret, mode: 'created' })
          }}
        />
      ) : null}

      {secretDialog ? (
        <WebhookSecretDialog state={secretDialog} onClose={() => setSecretDialog(null)} />
      ) : null}
    </SettingsCard>
  )
}

/** One-time secret reveal after create/rotate — the secret never crosses the wire again. */
function WebhookSecretDialog({
  state,
  onClose,
}: {
  state: SecretDialogState
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.secret)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{state.mode === 'created' ? 'Вебхук создан' : 'Секрет обновлён'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">{SECRET_DOC}</Alert>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box
              data-testid="webhook-secret-value"
              sx={{
                fontFamily: 'monospace',
                fontSize: 13,
                p: 1.5,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                flex: 1,
                wordBreak: 'break-all',
                bgcolor: 'action.hover',
              }}
            >
              {state.secret}
            </Box>
            <Tooltip title={copied ? 'Скопировано' : 'Скопировать'}>
              <IconButton onClick={copy} aria-label="Скопировать секрет">
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
          </Stack>
          {state.mode === 'rotated' ? (
            <Typography variant="caption" color="text.secondary">
              Старый секрет больше не действует — обновите его на принимающей стороне.
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Готово
        </Button>
      </DialogActions>
    </Dialog>
  )
}
