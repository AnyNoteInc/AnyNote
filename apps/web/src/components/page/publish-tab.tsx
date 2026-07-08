'use client'

import { useEffect, useState } from 'react'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  AdapterDateFns,
  Alert,
  Box,
  Button,
  Chip,
  ContentCopyIcon,
  DateTimePicker,
  dateFnsRu,
  Divider,
  ExpandMoreIcon,
  FormControlLabel,
  LocalizationProvider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { usePlanFeatures } from '@/components/workspace/plan-features-context'
import { trpc } from '@/trpc/client'

type ShareDate = string | Date | null

/** The publish-relevant slice of the `page.share.get` view-model. */
export type PublishShareModel = {
  shareId: string
  mode: 'LINK' | 'SITE'
  publishedAt: ShareDate
  unpublishedAt: ShareDate
  allowIndexing: boolean
  allowCopy: boolean
  publishSubpages: boolean
  analyticsGoogleId: string | null
  analyticsYandexMetricaId: string | null
  hasPassword: boolean
  exposesAt: ShareDate
}

type Props = {
  pageId: string
  share: PublishShareModel
  onChanged: () => void | Promise<unknown>
}

function toDate(value: ShareDate): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function isPublished(share: PublishShareModel): boolean {
  const published = toDate(share.publishedAt)
  if (!published) return false
  const unpublished = toDate(share.unpublishedAt)
  return !unpublished || unpublished.getTime() < published.getTime()
}

export function PublishTab({ pageId, share, onChanged }: Props) {
  const features = usePlanFeatures()
  const sitesEnabled = features.publicSitesEnabled

  const publish = trpc.page.share.publishSite.useMutation({ onSuccess: onChanged })
  const unpublish = trpc.page.share.unpublishSite.useMutation({ onSuccess: onChanged })
  const updateSite = trpc.page.share.updatePublicSiteSettings.useMutation({ onSuccess: onChanged })
  const setPassword = trpc.page.share.setSharePassword.useMutation({ onSuccess: onChanged })
  const clearPassword = trpc.page.share.clearSharePassword.useMutation({ onSuccess: onChanged })
  const setExposes = trpc.page.share.setExposesAt.useMutation({ onSuccess: onChanged })

  const published = isPublished(share)

  // Local draft for the free-text analytics ids — committed on blur so we
  // don't fire a mutation per keystroke.
  const [googleId, setGoogleId] = useState(share.analyticsGoogleId ?? '')
  const [yandexId, setYandexId] = useState(share.analyticsYandexMetricaId ?? '')
  const [password, setPasswordInput] = useState('')

  useEffect(() => {
    setGoogleId(share.analyticsGoogleId ?? '')
    setYandexId(share.analyticsYandexMetricaId ?? '')
  }, [share.analyticsGoogleId, share.analyticsYandexMetricaId])

  const [copied, setCopied] = useState(false)
  const publicUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/s/${share.shareId}` : ''

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (non-secure context / permission denied).
    }
  }

  function commitSiteSettings(
    patch: Partial<Pick<PublishShareModel, 'allowIndexing' | 'allowCopy' | 'publishSubpages'>> & {
      analyticsGoogleId?: string | null
      analyticsYandexMetricaId?: string | null
    },
  ) {
    updateSite.mutate({
      pageId,
      allowIndexing: patch.allowIndexing ?? share.allowIndexing,
      allowCopy: patch.allowCopy ?? share.allowCopy,
      publishSubpages: patch.publishSubpages ?? share.publishSubpages,
      analyticsGoogleId:
        patch.analyticsGoogleId !== undefined ? patch.analyticsGoogleId : share.analyticsGoogleId,
      analyticsYandexMetricaId:
        patch.analyticsYandexMetricaId !== undefined
          ? patch.analyticsYandexMetricaId
          : share.analyticsYandexMetricaId,
    })
  }

  const publishButton = (
    <Button
      variant="contained"
      color={published ? 'inherit' : 'primary'}
      disabled={(!published && !sitesEnabled) || publish.isPending || unpublish.isPending}
      onClick={() => (published ? unpublish.mutate({ pageId }) : publish.mutate({ pageId }))}
    >
      {published ? 'Снять с публикации' : 'Опубликовать сайт'}
    </Button>
  )

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      {/* Primary publish action + status. */}
      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        {!published && !sitesEnabled ? (
          <Tooltip title="Доступно на тарифе Pro и выше">
            <span>{publishButton}</span>
          </Tooltip>
        ) : (
          publishButton
        )}
        {published ? (
          <Chip label="Опубликован" color="success" size="small" />
        ) : share.mode === 'SITE' ? (
          <Chip label="Снят с публикации" size="small" variant="outlined" />
        ) : (
          <Chip label="Не опубликован" size="small" variant="outlined" />
        )}
      </Stack>

      {publish.error ? <Alert severity="error">{publish.error.message}</Alert> : null}

      {!sitesEnabled && !published ? (
        <Typography variant="caption" color="text.secondary">
          Публикация сайта доступна на тарифе Pro и выше.
        </Typography>
      ) : null}

      {/* Public URL (only useful once a row / site exists). */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
          Публичный адрес
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            fullWidth
            value={publicUrl}
            slotProps={{ input: { readOnly: true } }}
          />
          <Button
            size="small"
            startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
            onClick={copyUrl}
          >
            {copied ? 'Скопировано' : 'Копировать'}
          </Button>
        </Stack>
      </Box>

      <Divider />

      {/* Site settings. */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Настройки сайта
        </Typography>
        <Stack>
          <FormControlLabel
            control={
              <Switch
                checked={share.allowIndexing}
                onChange={(e) => commitSiteSettings({ allowIndexing: e.target.checked })}
              />
            }
            label="Индексация поисковыми системами"
          />
          <FormControlLabel
            control={
              <Switch
                checked={share.allowCopy}
                onChange={(e) => commitSiteSettings({ allowCopy: e.target.checked })}
              />
            }
            label="Разрешить копирование в пространство"
          />
          <FormControlLabel
            control={
              <Switch
                checked={share.publishSubpages}
                onChange={(e) => commitSiteSettings({ publishSubpages: e.target.checked })}
              />
            }
            label="Публиковать подстраницы"
          />
        </Stack>

        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            label="Google Analytics ID"
            placeholder="G-XXXXXXXXXX"
            value={googleId}
            onChange={(e) => setGoogleId(e.target.value)}
            onBlur={() => commitSiteSettings({ analyticsGoogleId: googleId.trim() || null })}
          />
        </Stack>
      </Box>

      {/* AnyNote-only extensions — clearly grouped, NOT Notion parity. */}
      <Accordion
        disableGutters
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          '&:before': { display: 'none' },
          bgcolor: 'action.hover',
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle2">Расширения AnyNote</Typography>
            <Chip label="не Notion" size="small" variant="outlined" />
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Дополнительные возможности AnyNote: парольная защита, отложенная публикация и
            Яндекс.Метрика.
          </Typography>

          <Stack spacing={2}>
            {/* Password gate. */}
            <Box>
              <Typography variant="body2" sx={{ mb: 0.75, fontWeight: 600 }}>
                Парольная защита
              </Typography>
              {share.hasPassword ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip label="Защищено паролем" color="warning" size="small" />
                  <Button
                    size="small"
                    color="error"
                    onClick={() => clearPassword.mutate({ pageId })}
                    disabled={clearPassword.isPending}
                  >
                    Убрать пароль
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField
                    size="small"
                    type="password"
                    placeholder="Новый пароль"
                    value={password}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!password || setPassword.isPending}
                    onClick={() => {
                      setPassword.mutate({ pageId, password })
                      setPasswordInput('')
                    }}
                  >
                    Установить
                  </Button>
                </Stack>
              )}
            </Box>

            {/* Scheduled publish. */}
            <Box>
              <Typography variant="body2" sx={{ mb: 0.75, fontWeight: 600 }}>
                Отложенная публикация
              </Typography>
              <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
                <DateTimePicker
                  label="Показать публично с"
                  value={toDate(share.exposesAt)}
                  onChange={(d: Date | null) => setExposes.mutate({ pageId, exposesAt: d })}
                  localeText={{ cancelButtonLabel: 'Отмена', okButtonLabel: 'Применить' }}
                  slotProps={{
                    textField: { size: 'small', fullWidth: true },
                    actionBar: { actions: ['clear', 'cancel', 'accept'] },
                  }}
                />
              </LocalizationProvider>
            </Box>

            {/* Yandex Metrica analytics. */}
            <TextField
              size="small"
              fullWidth
              label="Яндекс.Метрика ID"
              placeholder="12345678"
              value={yandexId}
              onChange={(e) => setYandexId(e.target.value)}
              onBlur={() =>
                commitSiteSettings({ analyticsYandexMetricaId: yandexId.trim() || null })
              }
            />
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  )
}
