'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  ContentCopyIcon,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import {
  VERIFICATION_TOKEN_TTL_DAYS,
  VERIFICATION_TXT_PREFIX,
} from '@repo/domain/identity/dto/identity.dto.ts'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspaceId: string
  locked: boolean
}

type ChipColor = 'default' | 'success' | 'warning'
type Notice = { severity: 'error' | 'success'; text: string }

const STATUS_LABELS: Record<string, { label: string; color: ChipColor }> = {
  PENDING: { label: 'Ожидает', color: 'default' },
  VERIFIED: { label: 'Подтверждён', color: 'success' },
  EXPIRED: { label: 'Истёк', color: 'warning' },
}

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/**
 * «Подтверждённые домены» — DNS-verified domain ownership, the gate for SSO
 * providers (spec §6). The TXT record is published on the domain ITSELF (the
 * check runs `resolveTxt(domain)` — no `_anynote-verification.` subdomain), so
 * the host instruction is `@` (the domain root). The token match is
 * case-sensitive by design (base62) and some DNS panels lowercase TXT values
 * on save — hence the mandatory «скопируйте точно как показано» wording
 * (packages/auth/src/sso.md).
 */
export function VerifiedDomainsCard({ workspaceId, locked }: Props) {
  const utils = trpc.useUtils()
  const [domain, setDomain] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; domain: string } | null>(null)

  const listQ = trpc.identity.verifiedDomains.list.useQuery({ workspaceId })
  const invalidate = () =>
    Promise.all([
      utils.identity.verifiedDomains.list.invalidate({ workspaceId }),
      // Removing/expiring a verified domain disables bound providers in-tx.
      utils.identity.providers.list.invalidate({ workspaceId }),
    ])

  const onError = (e: { message: string }) => {
    setNotice({ severity: 'error', text: e.message })
    // TOKEN_EXPIRED check failures flip the row to EXPIRED server-side.
    void invalidate()
  }

  const start = trpc.identity.verifiedDomains.start.useMutation({
    onSuccess: () => {
      setDomain('')
      setNotice(null)
      void invalidate()
    },
    onError,
  })
  const rotate = trpc.identity.verifiedDomains.rotate.useMutation({
    onSuccess: () => {
      setNotice({ severity: 'success', text: 'Выпущен новый токен — обновите TXT-запись.' })
      void invalidate()
    },
    onError,
  })
  const check = trpc.identity.verifiedDomains.check.useMutation({
    onSuccess: (result) => {
      setNotice(
        result.status === 'VERIFIED'
          ? { severity: 'success', text: `Домен ${result.domain} подтверждён.` }
          : {
              severity: 'error',
              text: result.lastCheckError ?? 'TXT-запись не найдена. Проверьте DNS и повторите.',
            },
      )
      void invalidate()
    },
    onError,
  })
  const remove = trpc.identity.verifiedDomains.remove.useMutation({
    onSuccess: () => {
      setRemoveTarget(null)
      setNotice(null)
      void invalidate()
    },
    onError: (e) => {
      setRemoveTarget(null)
      onError(e)
    },
  })

  async function copyTxtValue(rowId: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedId(rowId)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      // Clipboard may be unavailable (non-secure context / permission denied).
    }
  }

  const pending = start.isPending || rotate.isPending || check.isPending || remove.isPending

  return (
    <SettingsCard
      title="Подтверждённые домены"
      description="Подтвердите владение доменом через DNS — это обязательное условие для корпоративного входа (SSO)."
    >
      {notice ? (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          label="Домен"
          placeholder="company.ru"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          disabled={locked || start.isPending}
          size="small"
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { 'data-testid': 'identity-verified-domain-input' } }}
        />
        <Button
          data-testid="identity-verified-add"
          onClick={() => start.mutate({ workspaceId, domain: domain.trim() })}
          loading={start.isPending}
          disabled={locked || domain.trim().length < 3}
        >
          Подтвердить домен
        </Button>
      </Stack>

      {listQ.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : listQ.isError ? (
        <Alert severity="error">{listQ.error.message}</Alert>
      ) : listQ.data.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Подтверждённых доменов пока нет.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {listQ.data.map((row) => {
            const status = STATUS_LABELS[row.status] ?? {
              label: row.status,
              color: 'default' as const,
            }
            const txtValue = `${VERIFICATION_TXT_PREFIX}${row.verificationToken}`
            const showInstructions = row.status !== 'VERIFIED'
            return (
              <Box
                key={row.id}
                data-testid="identity-verified-row"
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  spacing={1}
                >
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    <Typography variant="subtitle2" sx={{ fontFamily: 'monospace' }}>
                      {row.domain}
                    </Typography>
                    <Chip size="small" color={status.color} label={status.label} />
                  </Stack>
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
                    {row.status === 'PENDING' ? (
                      <Button
                        size="small"
                        data-testid="identity-verify-check"
                        onClick={() => check.mutate({ workspaceId, domainId: row.id })}
                        loading={check.isPending}
                        disabled={locked || pending}
                      >
                        Проверить
                      </Button>
                    ) : null}
                    {row.status !== 'VERIFIED' ? (
                      <Button
                        size="small"
                        data-testid="identity-verify-rotate"
                        onClick={() => rotate.mutate({ workspaceId, domainId: row.id })}
                        loading={rotate.isPending}
                        disabled={locked || pending}
                      >
                        Новый токен
                      </Button>
                    ) : null}
                    <IconButton
                      size="small"
                      aria-label={`Удалить домен ${row.domain}`}
                      onClick={() => setRemoveTarget({ id: row.id, domain: row.domain })}
                      disabled={locked || remove.isPending}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>

                {row.lastCheckError && row.status !== 'VERIFIED' ? (
                  <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                    Последняя проверка{row.lastCheckedAt ? ` (${formatDate(row.lastCheckedAt)})` : ''}:{' '}
                    {row.lastCheckError}
                  </Typography>
                ) : null}

                {showInstructions ? (
                  <Box
                    sx={{
                      mt: 1.5,
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Добавьте TXT-запись в DNS домена {row.domain}
                    </Typography>
                    <Stack spacing={0.5}>
                      <Typography variant="body2">
                        Тип записи: <b>TXT</b>
                      </Typography>
                      <Typography variant="body2">
                        Хост (имя): <b>@</b> (корень домена)
                      </Typography>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Typography variant="body2" sx={{ flexShrink: 0 }}>
                          Значение:
                        </Typography>
                        <Typography
                          variant="body2"
                          data-testid="identity-verified-txt-value"
                          sx={{
                            fontFamily: 'monospace',
                            wordBreak: 'break-all',
                            minWidth: 0,
                          }}
                        >
                          {txtValue}
                        </Typography>
                        <Tooltip title={copiedId === row.id ? 'Скопировано' : 'Копировать'}>
                          <IconButton
                            size="small"
                            aria-label="Копировать значение TXT-записи"
                            onClick={() => void copyTxtValue(row.id, txtValue)}
                          >
                            <ContentCopyIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', mt: 1 }}
                    >
                      Скопируйте значение точно как показано: проверка чувствительна к регистру
                      символов, а некоторые DNS-панели приводят значение к нижнему регистру при
                      сохранении.
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Токен действует {VERIFICATION_TOKEN_TTL_DAYS} дней (до{' '}
                      {formatDate(row.tokenExpiresAt)}). Если срок истёк — выпустите новый токен.
                    </Typography>
                  </Box>
                ) : row.verifiedAt ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Подтверждён {formatDate(row.verifiedAt)}.
                  </Typography>
                ) : null}
              </Box>
            )
          })}
        </Stack>
      )}

      {removeTarget ? (
        <Dialog open onClose={() => setRemoveTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Удалить подтверждение домена {removeTarget.domain}?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Удаление отключит связанных провайдеров входа — вход сотрудников через них
              прекратится. Подтверждение можно будет пройти заново.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRemoveTarget(null)}>Отмена</Button>
            <Button
              color="error"
              variant="contained"
              data-testid="identity-verified-remove-confirm"
              loading={remove.isPending}
              onClick={() => remove.mutate({ workspaceId, domainId: removeTarget.id })}
            >
              Удалить
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </SettingsCard>
  )
}
