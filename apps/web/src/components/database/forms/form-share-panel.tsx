'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  ContentCopyIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@repo/ui/components'
import type { FormVersionDocument } from '@repo/domain/database/forms'

import { trpc } from '@/trpc/client'
import { usePlanFeatures } from '@/components/workspace/plan-features-context'

import type { DatabaseManagedForm } from '../types'

interface FormSharePanelProps {
  readonly open: boolean
  readonly pageId: string
  readonly form: DatabaseManagedForm
  readonly draftDocument: FormVersionDocument
  readonly hideBranding: boolean
  readonly onClose: () => void
  readonly onChanged: () => Promise<void> | void
  readonly onBrandingChange: (hidden: boolean) => void
}

function dateTimeLocal(date: Date | string | null): string {
  if (!date) return ''
  const parsed = new Date(date)
  const offset = parsed.getTimezoneOffset() * 60_000
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16)
}

function formUrl(form: DatabaseManagedForm): string {
  const locator = form.customSlug ?? form.routeKey
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/f/${locator}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function FormSharePanel({
  open,
  pageId,
  form,
  draftDocument,
  hideBranding,
  onClose,
  onChanged,
  onBrandingChange,
}: FormSharePanelProps) {
  const features = usePlanFeatures()
  const [audience, setAudience] = useState(form.audience)
  const [respondentAccess, setRespondentAccess] = useState(form.respondentAccess)
  const [opensAt, setOpensAt] = useState(() => dateTimeLocal(form.opensAt))
  const [closesAt, setClosesAt] = useState(() => dateTimeLocal(form.closesAt))
  const [responseLimit, setResponseLimit] = useState(form.responseLimit?.toString() ?? '')
  const [notifyOwners, setNotifyOwners] = useState(form.notifyOwners)
  const [slug, setSlug] = useState(form.customSlug ?? '')
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = useMemo(() => formUrl(form), [form])
  const hasUnpublishedChanges = useMemo(
    () =>
      form.publishedVersion !== null &&
      canonicalJson(draftDocument) !== canonicalJson(form.publishedVersion.schema),
    [draftDocument, form.publishedVersion],
  )

  useEffect(() => {
    setAudience(form.audience)
    setRespondentAccess(form.respondentAccess)
    setOpensAt(dateTimeLocal(form.opensAt))
    setClosesAt(dateTimeLocal(form.closesAt))
    setResponseLimit(form.responseLimit?.toString() ?? '')
    setNotifyOwners(form.notifyOwners)
    setSlug(form.customSlug ?? '')
  }, [form])

  const updateSettings = trpc.database.updateFormSettings.useMutation()
  const setFormSlug = trpc.database.setFormSlug.useMutation()
  const rotateKey = trpc.database.rotateFormKey.useMutation()
  const closeForm = trpc.database.closeForm.useMutation()
  const reopenForm = trpc.database.reopenForm.useMutation()

  async function run(operation: () => Promise<unknown>) {
    setError(null)
    try {
      await operation()
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Публикация и доступ</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 0.5 }}>
          <Alert
            severity={
              form.state === 'DRAFT' ? 'info' : form.state === 'OPEN' ? 'success' : 'warning'
            }
          >
            {form.state === 'DRAFT'
              ? 'Форма ещё не опубликована. Ссылка начнёт работать после первой публикации.'
              : form.state === 'OPEN'
                ? 'Форма открыта для ответов.'
                : 'Форма закрыта для новых ответов.'}
          </Alert>
          {form.publishedVersion ? (
            <Alert severity={hasUnpublishedChanges ? 'warning' : 'success'} variant="outlined">
              Опубликована версия {form.publishedVersion.versionNumber}.{' '}
              {hasUnpublishedChanges
                ? 'Есть неопубликованные изменения.'
                : 'Все изменения опубликованы.'}
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={1}>
            <TextField
              label="Ссылка"
              value={url}
              size="small"
              fullWidth
              slotProps={{ htmlInput: { readOnly: true } }}
            />
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={async () => {
                await navigator.clipboard.writeText(url)
                setCopied(true)
              }}
            >
              {copied ? 'Скопировано' : 'Копировать'}
            </Button>
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Свой адрес"
              value={slug}
              disabled={!features.formCustomSlugEnabled}
              helperText={
                features.formCustomSlugEnabled
                  ? 'anynote.ru/f/ваш-адрес'
                  : 'Доступно на старшем плане'
              }
              onChange={(event) => setSlug(event.target.value)}
              size="small"
              fullWidth
            />
            <Button
              variant="outlined"
              disabled={!features.formCustomSlugEnabled}
              onClick={() =>
                run(() =>
                  setFormSlug.mutateAsync({ pageId, formId: form.id, slug: slug.trim() || null }),
                )
              }
            >
              Сохранить
            </Button>
          </Stack>
          <FormControl size="small" fullWidth>
            <InputLabel id="form-audience-label">Кто может отвечать</InputLabel>
            <Select
              labelId="form-audience-label"
              label="Кто может отвечать"
              value={audience}
              onChange={(event) => setAudience(event.target.value as typeof audience)}
            >
              <MenuItem value="ANYONE_WITH_LINK">Все, у кого есть ссылка</MenuItem>
              <MenuItem value="SIGNED_IN_WITH_LINK">Вошедшие пользователи</MenuItem>
              <MenuItem value="WORKSPACE_MEMBERS_WITH_LINK">Участники пространства</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth disabled={audience === 'ANYONE_WITH_LINK'}>
            <InputLabel id="form-respondent-access-label">Доступ к созданной записи</InputLabel>
            <Select
              labelId="form-respondent-access-label"
              label="Доступ к созданной записи"
              value={respondentAccess}
              onChange={(event) =>
                setRespondentAccess(event.target.value as typeof respondentAccess)
              }
            >
              <MenuItem value="NONE">Нет</MenuItem>
              <MenuItem value="VIEW">Просмотр</MenuItem>
              <MenuItem value="EDIT">Редактирование</MenuItem>
            </Select>
          </FormControl>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              type="datetime-local"
              label="Открыть"
              value={opensAt}
              onChange={(event) => setOpensAt(event.target.value)}
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="datetime-local"
              label="Закрыть"
              value={closesAt}
              onChange={(event) => setClosesAt(event.target.value)}
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          <TextField
            type="number"
            label="Лимит ответов"
            value={responseLimit}
            onChange={(event) => setResponseLimit(event.target.value)}
            size="small"
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <FormControlLabel
            control={
              <Switch checked={notifyOwners} onChange={(_, checked) => setNotifyOwners(checked)} />
            }
            label="Уведомлять владельцев о новых ответах"
          />
          <Button
            variant="contained"
            onClick={() =>
              run(() =>
                updateSettings.mutateAsync({
                  pageId,
                  formId: form.id,
                  audience,
                  respondentAccess: audience === 'ANYONE_WITH_LINK' ? 'NONE' : respondentAccess,
                  opensAt: opensAt ? new Date(opensAt) : null,
                  closesAt: closesAt ? new Date(closesAt) : null,
                  responseLimit: responseLimit ? Number(responseLimit) : null,
                  notifyOwners,
                }),
              )
            }
          >
            Сохранить настройки
          </Button>
          <FormControlLabel
            control={
              <Checkbox
                checked={hideBranding}
                disabled={!features.formBrandingRemovalEnabled}
                onChange={(_, checked) => onBrandingChange(checked)}
              />
            }
            label="Скрыть брендинг AnyNote"
          />
          {!features.formBrandingRemovalEnabled ? (
            <Typography variant="caption" color="text.secondary">
              Скрытие брендинга доступно на старшем плане.
            </Typography>
          ) : null}
          {!features.formConditionalLogicEnabled ? (
            <Typography variant="caption" color="text.secondary">
              Разветвлённые маршруты доступны на старшем плане.
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1}>
            {form.state === 'OPEN' ? (
              <Button
                variant="outlined"
                color="warning"
                onClick={() => run(() => closeForm.mutateAsync({ pageId, formId: form.id }))}
              >
                Закрыть форму
              </Button>
            ) : form.state === 'CLOSED' ? (
              <Button
                variant="outlined"
                onClick={() => run(() => reopenForm.mutateAsync({ pageId, formId: form.id }))}
              >
                Открыть форму
              </Button>
            ) : null}
            <Button variant="text" color="warning" onClick={() => setConfirmRotate(true)}>
              Сменить секретную ссылку
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Готово</Button>
      </DialogActions>
      <Dialog open={confirmRotate} onClose={() => setConfirmRotate(false)}>
        <DialogTitle>Сменить ссылку?</DialogTitle>
        <DialogContent>
          <Typography>Старая ссылка сразу перестанет работать.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRotate(false)}>Отмена</Button>
          <Button
            color="warning"
            onClick={() => {
              setConfirmRotate(false)
              void run(() => rotateKey.mutateAsync({ pageId, formId: form.id }))
            }}
          >
            Сменить
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  )
}
