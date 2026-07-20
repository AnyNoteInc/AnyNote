'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@repo/ui/components'

import type { RouterOutputs } from '@/trpc/client'

import { FormRenderer } from '@/components/forms/form-renderer'
import { setPendingCaptchaToken } from '@/lib/captcha-token-store'
import {
  clearFormDraft,
  formDraftStorageKey,
  getBrowserFormDraftStorage,
  restoreFormDraft,
  saveFormDraft,
} from '@/lib/form-draft-storage'
import { useRecaptchaV3 } from '@/lib/use-recaptcha-v3'
import { trpc } from '@/trpc/client'

export type PublishedFormPayload = Extract<
  RouterOutputs['form']['getPublished'],
  { status: 'OPEN' }
>

type PublicFieldErrors = Record<string, readonly string[]>

function extractFieldErrors(error: unknown): PublicFieldErrors | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null || !('fieldErrors' in data)) return undefined
  const fieldErrors = data.fieldErrors
  return typeof fieldErrors === 'object' && fieldErrors !== null && !Array.isArray(fieldErrors)
    ? (fieldErrors as PublicFieldErrors)
    : undefined
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null || !('code' in data)) return undefined
  return typeof data.code === 'string' ? data.code : undefined
}

function errorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined
  return typeof error.message === 'string' ? error.message : undefined
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function canonicalAnswers(answers: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(answers))
}

const CAPTCHA_ERROR = 'Не удалось запустить защиту формы. Обновите страницу и попробуйте снова.'

function qrImageUrl(formUrl: string): string {
  if (!formUrl) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=1&data=${encodeURIComponent(formUrl)}`
}

export function FormPageClient({
  locator,
  published,
}: {
  locator: string
  published: PublishedFormPayload
}) {
  const router = useRouter()
  const executeRecaptcha = useRecaptchaV3()
  const submit = trpc.form.submit.useMutation()
  const utils = trpc.useUtils()
  const draftKey = useMemo(
    () => formDraftStorageKey(locator, published.versionFingerprint),
    [locator, published.versionFingerprint],
  )
  const formUrl = useMemo(
    () => (typeof window === 'undefined' ? '' : `${window.location.origin}/f/${locator}`),
    [locator],
  )
  const qrUrl = useMemo(() => qrImageUrl(formUrl), [formUrl])
  const [draftReady, setDraftReady] = useState(false)
  const [initialAnswers, setInitialAnswers] = useState<Record<string, unknown>>({})
  const [serverFieldErrors, setServerFieldErrors] = useState<PublicFieldErrors>({})
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [successEndingId, setSuccessEndingId] = useState<string | undefined>()
  const [incompatibleDraft, setIncompatibleDraft] = useState<{
    sourceKey: string
    count: number
  } | null>(null)
  const idempotentAttempt = useRef<{ key: string; payload: string } | null>(null)

  useEffect(() => {
    const storage = getBrowserFormDraftStorage()
    const restored = restoreFormDraft(
      storage,
      locator,
      published.versionFingerprint,
      published.version,
    )
    setInitialAnswers(restored?.answers ?? {})
    if (restored !== null && restored.sourceKey !== draftKey) {
      if (Object.keys(restored.answers).length > 0) {
        saveFormDraft(storage, draftKey, restored.answers, new Date(), published.version)
      }
      const incompatibleCount = Object.keys(restored.incompatible).length
      if (incompatibleCount > 0) {
        setIncompatibleDraft({ sourceKey: restored.sourceKey, count: incompatibleCount })
      } else {
        clearFormDraft(storage, restored.sourceKey)
      }
    }
    setDraftReady(true)
  }, [draftKey, locator, published.version, published.versionFingerprint])

  const handleAnswersChange = useCallback(
    (answers: Record<string, unknown>) => {
      const storage = getBrowserFormDraftStorage()
      if (Object.keys(answers).length === 0) clearFormDraft(storage, draftKey)
      else saveFormDraft(storage, draftKey, answers, new Date(), published.version)
    },
    [draftKey, published.version],
  )

  const handleReset = useCallback(() => {
    clearFormDraft(getBrowserFormDraftStorage(), draftKey)
    if (incompatibleDraft !== null) {
      clearFormDraft(getBrowserFormDraftStorage(), incompatibleDraft.sourceKey)
      setIncompatibleDraft(null)
    }
    setServerFieldErrors({})
    setGlobalError(null)
    idempotentAttempt.current = null
  }, [draftKey, incompatibleDraft])

  const handleSubmit = useCallback(
    async ({ answers }: { answers: Record<string, unknown> }) => {
      setGlobalError(null)
      setServerFieldErrors({})
      let captcha: string | null
      try {
        captcha = await executeRecaptcha('form_submit')
      } catch {
        setGlobalError(CAPTCHA_ERROR)
        throw new Error('FORM_CAPTCHA_UNAVAILABLE')
      }
      if (captcha === null) {
        setGlobalError(CAPTCHA_ERROR)
        throw new Error('FORM_CAPTCHA_UNAVAILABLE')
      }

      const payload = canonicalAnswers(answers)
      if (idempotentAttempt.current?.payload !== payload) {
        idempotentAttempt.current = { key: crypto.randomUUID(), payload }
      }
      setPendingCaptchaToken(captcha)
      try {
        const result = await submit.mutateAsync({
          locator,
          versionToken: published.versionToken,
          idempotencyKey: idempotentAttempt.current.key,
          answers,
          honeypot: '',
        })
        clearFormDraft(getBrowserFormDraftStorage(), draftKey)
        if (incompatibleDraft !== null) {
          clearFormDraft(getBrowserFormDraftStorage(), incompatibleDraft.sourceKey)
          setIncompatibleDraft(null)
        }
        idempotentAttempt.current = null
        setSuccessEndingId(result.endingId)
      } catch (error) {
        const fieldErrors = extractFieldErrors(error)
        const domainMessage = errorMessage(error)
        if (fieldErrors !== undefined) {
          setServerFieldErrors(fieldErrors)
        } else if (domainMessage === 'FORM_VERSION_STALE') {
          setGlobalError('Форма обновилась. Загружаем актуальную версию…')
        } else if (domainMessage === 'FORM_NOT_ACCEPTING') {
          setGlobalError('Форма больше не принимает ответы. Обновляем её состояние…')
        } else {
          setGlobalError('Ответ не отправлен. Проверьте соединение и попробуйте снова.')
        }

        // A server response consumed this logical attempt. Only transport-level
        // uncertainty keeps the key so an automatic/manual retry stays idempotent.
        if (errorCode(error) !== undefined) idempotentAttempt.current = null
        if (
          errorCode(error) === 'PRECONDITION_FAILED' ||
          domainMessage === 'FORM_VERSION_STALE' ||
          domainMessage === 'FORM_NOT_ACCEPTING'
        ) {
          router.refresh()
        }
        throw error
      }
    },
    [
      draftKey,
      executeRecaptcha,
      incompatibleDraft,
      locator,
      published.versionToken,
      router,
      submit,
    ],
  )

  const handleUpload = useCallback(
    async (questionId: string, file: File) => {
      setGlobalError(null)
      let captcha: string | null
      try {
        captcha = await executeRecaptcha('form_upload')
      } catch {
        setGlobalError(CAPTCHA_ERROR)
        throw new Error('FORM_CAPTCHA_UNAVAILABLE')
      }
      if (captcha === null) {
        setGlobalError(CAPTCHA_ERROR)
        throw new Error('FORM_CAPTCHA_UNAVAILABLE')
      }
      const body = new FormData()
      body.set('file', file)
      body.set('questionId', questionId)
      body.set('versionToken', published.versionToken)
      const response = await fetch(`/api/forms/${encodeURIComponent(locator)}/uploads`, {
        method: 'POST',
        headers: { 'x-captcha-response': captcha },
        body,
      })
      if (!response.ok) throw new Error('FORM_UPLOAD_FAILED')
      const result = (await response.json()) as {
        uploadToken: string
        file: { name: string; mimeType: string; fileSize: string; expiresAt: string }
      }
      return { token: result.uploadToken, ...result.file }
    },
    [executeRecaptcha, locator, published.versionToken],
  )

  const handleLoadPickerOptions = useCallback(
    (questionId: string, query: string, cursor?: string) =>
      utils.client.form.listPickerOptions.query({
        locator,
        versionToken: published.versionToken,
        questionId,
        query: query || undefined,
        cursor,
        limit: 50,
      }),
    [locator, published.versionToken, utils.client.form.listPickerOptions],
  )

  if (!draftReady) {
    return (
      <Box component="main" aria-label="Загрузка формы" sx={{ minHeight: '100vh' }}>
        <LinearProgress />
      </Box>
    )
  }

  return (
    <>
      {globalError ? (
        <Alert severity="error" role="alert" sx={{ borderRadius: 0 }}>
          {globalError}
        </Alert>
      ) : null}
      {incompatibleDraft ? (
        <Alert
          severity="warning"
          role="status"
          sx={{ borderRadius: 0 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                clearFormDraft(getBrowserFormDraftStorage(), incompatibleDraft.sourceKey)
                setIncompatibleDraft(null)
              }}
            >
              Удалить локальные данные
            </Button>
          }
        >
          {incompatibleDraft.count === 1
            ? 'Один ответ из старой версии несовместим и пока сохранён только в этом браузере.'
            : `${incompatibleDraft.count} ответа из старой версии несовместимы и пока сохранены только в этом браузере.`}
        </Alert>
      ) : null}
      <Box sx={{ px: 2.5, py: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Stack
          spacing={1}
          sx={{
            p: 1.5,
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            alignItems: 'center',
            backgroundColor: 'background.paper',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            QR-код формы
          </Typography>
          {qrUrl ? (
            <Box
              component="img"
              src={qrUrl}
              alt="QR-код для открытия формы"
              width={96}
              height={96}
              loading="lazy"
              sx={{ borderRadius: 1 }}
            />
          ) : null}
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigator.clipboard.writeText(formUrl)}
          >
            Копировать ссылку
          </Button>
        </Stack>
      </Box>
      <FormRenderer
        version={published.version}
        mode="public"
        initialAnswers={initialAnswers}
        onAnswersChange={handleAnswersChange}
        onReset={handleReset}
        onSubmit={handleSubmit}
        serverFieldErrors={serverFieldErrors}
        successEndingId={successEndingId}
        submitAgainPath={`/f/${locator}`}
        homePath="/"
        onUpload={handleUpload}
        onLoadPickerOptions={handleLoadPickerOptions}
      />
    </>
  )
}
