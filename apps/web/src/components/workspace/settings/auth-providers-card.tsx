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
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspaceId: string
  locked: boolean
}

type ChipColor = 'default' | 'success'
type Notice = { severity: 'error' | 'success'; text: string }

type ProviderRow = {
  id: string
  type: 'OIDC' | 'OAUTH' | 'SAML_RESERVED'
  name: string
  status: 'ACTIVE' | 'DISABLED'
  domainId: string | null
  issuerUrl: string | null
  clientId: string | null
  hasClientSecret: boolean
}

const STATUS_LABELS: Record<string, { label: string; color: ChipColor }> = {
  ACTIVE: { label: 'Активен', color: 'success' },
  DISABLED: { label: 'Отключен', color: 'default' },
}

const TYPE_LABELS: Record<ProviderRow['type'], string> = {
  OIDC: 'OIDC',
  OAUTH: 'OAuth 2.0',
  SAML_RESERVED: 'SAML (скоро)',
}

type EditorState = { mode: 'create' } | { mode: 'edit'; provider: ProviderRow }
type ConfirmState = { kind: 'disable' | 'delete'; provider: ProviderRow }

/**
 * «Провайдеры входа» — per-workspace SSO providers (spec §6). Create/edit with
 * a WRITE-ONLY secret field (the read shape only ever carries the
 * `hasClientSecret` presence flag); activation binds the provider to a
 * VERIFIED domain — the server rejects anything else with DOMAIN_NOT_VERIFIED.
 *
 * NOTE: the planned «Яндекс ID» preset button is deliberately omitted:
 * neither https://login.yandex.ru/.well-known/openid-configuration (HTTP 404)
 * nor https://oauth.yandex.ru/.well-known/openid-configuration (HTML error
 * page, not JSON) serves an OIDC discovery document (checked 2026-06-12), and
 * the activation port hydrates the provider from exactly
 * `<issuer>/.well-known/openid-configuration` (packages/auth/src/sso.md) — a
 * prefilled preset would always fail at activation.
 */
export function AuthProvidersCard({ workspaceId, locked }: Props) {
  const utils = trpc.useUtils()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [activateTarget, setActivateTarget] = useState<ProviderRow | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)

  const providersQ = trpc.identity.providers.list.useQuery({ workspaceId })
  // Shares the query key with VerifiedDomainsCard — react-query dedupes.
  const verifiedQ = trpc.identity.verifiedDomains.list.useQuery({ workspaceId })

  const invalidate = () => utils.identity.providers.list.invalidate({ workspaceId })
  const onError = (e: { message: string }) => setNotice({ severity: 'error', text: e.message })

  const disable = trpc.identity.providers.disable.useMutation({
    onSuccess: () => {
      setConfirm(null)
      setNotice({ severity: 'success', text: 'Провайдер отключён — вход через него прекращён.' })
      void invalidate()
    },
    onError: (e) => {
      setConfirm(null)
      onError(e)
    },
  })
  const del = trpc.identity.providers.delete.useMutation({
    onSuccess: () => {
      setConfirm(null)
      setNotice({ severity: 'success', text: 'Провайдер удалён.' })
      void invalidate()
    },
    onError: (e) => {
      setConfirm(null)
      onError(e)
    },
  })

  const domainsById = new Map((verifiedQ.data ?? []).map((d) => [d.id, d.domain]))
  const verifiedDomains = (verifiedQ.data ?? []).filter((d) => d.status === 'VERIFIED')

  return (
    <SettingsCard
      title="Провайдеры входа"
      description="Корпоративный вход (SSO) через OIDC/OAuth-провайдера для сотрудников с почтой на подтверждённом домене."
    >
      {notice ? (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      ) : null}

      {providersQ.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : providersQ.isError ? (
        <Alert severity="error">{providersQ.error.message}</Alert>
      ) : providersQ.data.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Провайдеров пока нет.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {providersQ.data.map((provider) => {
            const status = STATUS_LABELS[provider.status] ?? {
              label: provider.status,
              color: 'default' as const,
            }
            const boundDomain = provider.domainId
              ? (domainsById.get(provider.domainId) ?? null)
              : null
            return (
              <Box
                key={provider.id}
                data-testid="identity-provider-row"
                sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
              >
                <Stack
                  direction="row"

                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    <Typography variant="subtitle2">{provider.name}</Typography>
                    <Chip size="small" variant="outlined" label={TYPE_LABELS[provider.type]} />
                    <Chip size="small" color={status.color} label={status.label} />
                    {boundDomain ? (
                      <Chip size="small" variant="outlined" label={`Домен: ${boundDomain}`} />
                    ) : null}
                  </Stack>
                  <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, alignItems: 'center' }}>
                    {provider.status === 'DISABLED' && provider.type !== 'SAML_RESERVED' ? (
                      <Button
                        size="small"
                        data-testid="identity-provider-activate"
                        onClick={() => setActivateTarget(provider)}
                        disabled={locked}
                      >
                        Активировать
                      </Button>
                    ) : null}
                    {provider.status === 'ACTIVE' ? (
                      <Button
                        size="small"
                        color="warning"
                        onClick={() => setConfirm({ kind: 'disable', provider })}
                        disabled={locked || disable.isPending}
                      >
                        Отключить
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      onClick={() => setEditor({ mode: 'edit', provider })}
                      disabled={locked}
                    >
                      Изменить
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      onClick={() => setConfirm({ kind: 'delete', provider })}
                      disabled={locked || del.isPending}
                    >
                      Удалить
                    </Button>
                  </Stack>
                </Stack>
                {provider.issuerUrl ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace' }}
                  >
                    {provider.issuerUrl}
                  </Typography>
                ) : null}
              </Box>
            )
          })}
        </Stack>
      )}

      <Button
        variant="outlined"
        size="small"
        data-testid="identity-provider-create"
        onClick={() => setEditor({ mode: 'create' })}
        disabled={locked}
        sx={{ alignSelf: 'flex-start' }}
      >
        Добавить провайдера
      </Button>

      {editor ? (
        <ProviderEditorDialog
          workspaceId={workspaceId}
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={(text) => {
            setEditor(null)
            setNotice({ severity: 'success', text })
            void invalidate()
          }}
        />
      ) : null}

      {activateTarget ? (
        <ActivateProviderDialog
          workspaceId={workspaceId}
          provider={activateTarget}
          verifiedDomains={verifiedDomains.map((d) => ({ id: d.id, domain: d.domain }))}
          onClose={() => setActivateTarget(null)}
          onActivated={() => {
            setActivateTarget(null)
            setNotice({ severity: 'success', text: 'Провайдер активирован — вход по SSO включён.' })
            void invalidate()
          }}
        />
      ) : null}

      {confirm ? (
        <Dialog open onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
          <DialogTitle>
            {confirm.kind === 'disable'
              ? `Отключить провайдера «${confirm.provider.name}»?`
              : `Удалить провайдера «${confirm.provider.name}»?`}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {confirm.kind === 'disable'
                ? 'Вход сотрудников через этого провайдера прекратится. Настройки сохранятся — провайдера можно будет активировать заново.'
                : 'Провайдер и его настройки будут удалены без возможности восстановления, вход через него прекратится.'}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(null)}>Отмена</Button>
            <Button
              color={confirm.kind === 'disable' ? 'warning' : 'error'}
              variant="contained"
              loading={disable.isPending || del.isPending}
              onClick={() => {
                const input = { workspaceId, providerId: confirm.provider.id }
                if (confirm.kind === 'disable') disable.mutate(input)
                else del.mutate(input)
              }}
            >
              {confirm.kind === 'disable' ? 'Отключить' : 'Удалить'}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </SettingsCard>
  )
}

function ProviderEditorDialog({
  workspaceId,
  editor,
  onClose,
  onSaved,
}: {
  workspaceId: string
  editor: EditorState
  onClose: () => void
  onSaved: (noticeText: string) => void
}) {
  const isEdit = editor.mode === 'edit'
  const initial = isEdit ? editor.provider : null

  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'OIDC' | 'OAUTH'>(
    initial && initial.type !== 'SAML_RESERVED' ? initial.type : 'OIDC',
  )
  const [issuerUrl, setIssuerUrl] = useState(initial?.issuerUrl ?? '')
  const [clientId, setClientId] = useState(initial?.clientId ?? '')
  // Write-only: never prefilled — empty on edit means «keep the stored secret».
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = trpc.identity.providers.create.useMutation({
    onSuccess: () => onSaved('Провайдер создан. Активируйте его, выбрав подтверждённый домен.'),
    onError: (e: { message: string }) => setError(e.message),
  })
  const update = trpc.identity.providers.update.useMutation({
    onSuccess: () => onSaved('Провайдер обновлён.'),
    onError: (e: { message: string }) => setError(e.message),
  })
  const pending = create.isPending || update.isPending

  const canSubmit = isEdit
    ? name.trim().length > 0
    : name.trim().length > 0 &&
      issuerUrl.trim().length > 0 &&
      clientId.trim().length > 0 &&
      clientSecret.length > 0

  function submit() {
    setError(null)
    if (isEdit && initial) {
      update.mutate({
        workspaceId,
        providerId: initial.id,
        name: name.trim(),
        issuerUrl: issuerUrl.trim() || undefined,
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.length > 0 ? clientSecret : undefined,
      })
    } else {
      create.mutate({
        workspaceId,
        type,
        name: name.trim(),
        issuerUrl: issuerUrl.trim(),
        clientId: clientId.trim(),
        clientSecret,
      })
    }
  }

  return (
    <Dialog open onClose={pending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Изменить провайдера' : 'Новый провайдер входа'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error ? (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          <TextField
            label="Название"
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="small"
            disabled={pending}
            helperText="Отображается сотрудникам на странице входа"
            slotProps={{ htmlInput: { 'data-testid': 'identity-provider-name', maxLength: 100 } }}
          />
          <FormControl size="small" disabled={pending || isEdit}>
            <InputLabel id="identity-provider-type-label">Тип</InputLabel>
            <Select
              labelId="identity-provider-type-label"
              label="Тип"
              value={isEdit && initial?.type === 'SAML_RESERVED' ? 'SAML_RESERVED' : type}
              onChange={(event) => setType(event.target.value as 'OIDC' | 'OAUTH')}
            >
              <MenuItem value="OIDC">OIDC (OpenID Connect)</MenuItem>
              <MenuItem value="OAUTH">OAuth 2.0</MenuItem>
              {/* Honest «скоро»: SAML stays reserved — no live endpoints exist. */}
              <MenuItem value="SAML_RESERVED" disabled>
                SAML — скоро
              </MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Issuer / discovery URL"
            value={issuerUrl}
            onChange={(event) => setIssuerUrl(event.target.value)}
            size="small"
            disabled={pending}
            placeholder="https://idp.company.ru"
            helperText="https-адрес провайдера; конфигурация будет получена из <issuer>/.well-known/openid-configuration"
            slotProps={{ htmlInput: { 'data-testid': 'identity-provider-issuer', maxLength: 500 } }}
          />
          <TextField
            label="Client ID"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            size="small"
            disabled={pending}
            autoComplete="off"
            slotProps={{
              htmlInput: { 'data-testid': 'identity-provider-client-id', maxLength: 255 },
            }}
          />
          <TextField
            label="Client secret"
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            size="small"
            disabled={pending}
            autoComplete="new-password"
            helperText={
              isEdit
                ? 'Секрет хранится в зашифрованном виде и не отображается. Оставьте поле пустым, чтобы не менять его.'
                : 'Секрет хранится в зашифрованном виде и не отображается после сохранения.'
            }
            slotProps={{
              htmlInput: { 'data-testid': 'identity-provider-secret', maxLength: 4096 },
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          Отмена
        </Button>
        <Button
          variant="contained"
          data-testid="identity-provider-save"
          loading={pending}
          disabled={!canSubmit}
          onClick={submit}
        >
          {isEdit ? 'Сохранить' : 'Создать'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ActivateProviderDialog({
  workspaceId,
  provider,
  verifiedDomains,
  onClose,
  onActivated,
}: {
  workspaceId: string
  provider: ProviderRow
  verifiedDomains: { id: string; domain: string }[]
  onClose: () => void
  onActivated: () => void
}) {
  const [domainId, setDomainId] = useState(verifiedDomains[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  const activate = trpc.identity.providers.activate.useMutation({
    onSuccess: onActivated,
    onError: (e: { message: string }) => setError(e.message),
  })

  return (
    <Dialog open onClose={activate.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Активировать «{provider.name}»?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error ? (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          ) : null}
          {verifiedDomains.length === 0 ? (
            <Alert severity="warning" data-testid="identity-activate-no-domain">
              Сначала подтвердите домен — провайдера входа можно привязать только к подтверждённому
              домену.
            </Alert>
          ) : (
            <>
              <DialogContentText>
                Сотрудники с почтой на выбранном домене смогут входить через этого провайдера.
              </DialogContentText>
              <FormControl size="small">
                <InputLabel id="identity-activate-domain-label">Подтверждённый домен</InputLabel>
                <Select
                  labelId="identity-activate-domain-label"
                  label="Подтверждённый домен"
                  value={domainId}
                  onChange={(event) => setDomainId(event.target.value)}
                  data-testid="identity-activate-domain-select"
                >
                  {verifiedDomains.map((d) => (
                    <MenuItem key={d.id} value={d.id}>
                      {d.domain}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={activate.isPending}>
          Отмена
        </Button>
        <Button
          variant="contained"
          data-testid="identity-provider-activate-confirm"
          loading={activate.isPending}
          disabled={verifiedDomains.length === 0 || !domainId}
          onClick={() => activate.mutate({ workspaceId, providerId: provider.id, domainId })}
        >
          Активировать
        </Button>
      </DialogActions>
    </Dialog>
  )
}
