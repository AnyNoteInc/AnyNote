'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Alert, Button } from '@repo/ui/components'

import type { RouterOutputs } from '@/trpc/client'

import { FormRenderer } from '@/components/forms/form-renderer'
import { useRecaptchaV3 } from '@/lib/use-recaptcha-v3'
import { trpc } from '@/trpc/client'

export type OwnResponsePayload = RouterOutputs['form']['getOwnResponse']

type FieldErrors = Record<string, readonly string[]>

function extractFieldErrors(error: unknown): FieldErrors | undefined {
  if (typeof error !== 'object' || error === null || !('data' in error)) return undefined
  const data = error.data
  if (typeof data !== 'object' || data === null || !('fieldErrors' in data)) return undefined
  const fieldErrors = data.fieldErrors
  return typeof fieldErrors === 'object' && fieldErrors !== null && !Array.isArray(fieldErrors)
    ? (fieldErrors as FieldErrors)
    : undefined
}

function errorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined
  return typeof error.message === 'string' ? error.message : undefined
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize)
    if (candidate !== null && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      )
    }
    return candidate
  }
  return JSON.stringify(normalize(value))
}

const CAPTCHA_ERROR = 'Не удалось запустить защиту формы. Обновите страницу и попробуйте снова.'

export function OwnResponseClient({
  locator,
  submissionId,
  response: initialResponse,
}: {
  locator: string
  submissionId: string
  response: OwnResponsePayload
}) {
  const router = useRouter()
  const executeRecaptcha = useRecaptchaV3()
  const update = trpc.form.updateOwnResponse.useMutation()
  const utils = trpc.useUtils()
  const [response, setResponse] = useState(initialResponse)
  const savedAnswersFingerprint = useRef(canonicalJson(initialResponse.answers))
  const currentAnswersFingerprint = useRef(savedAnswersFingerprint.current)
  const currentAnswers = useRef(initialResponse.answers)
  const saveInFlight = useRef(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingClear, setPendingClear] = useState<{
    answers: Record<string, unknown>
    fingerprint: string
    questionIds: string[]
  } | null>(null)

  const unavailableQuestionIds = useMemo(
    () => response.version.questions.filter(({ available }) => !available).map(({ id }) => id),
    [response.version.questions],
  )
  const initialFileNames = useMemo(
    () =>
      Object.fromEntries(
        Object.values(response.files)
          .flat()
          .map(({ handle, name }) => [handle, name]),
      ),
    [response.files],
  )
  const questionLabels = useMemo(
    () => new Map(response.version.questions.map(({ id, label }) => [id, label])),
    [response.version.questions],
  )

  const save = useCallback(
    async (answers: Record<string, unknown>, confirmClearUnreachable: boolean) => {
      if (saveInFlight.current) return
      saveInFlight.current = true
      setSaving(true)
      const submittedFingerprint = canonicalJson(answers)
      currentAnswers.current = answers
      currentAnswersFingerprint.current = submittedFingerprint
      setFieldErrors({})
      setGlobalError(null)
      setSaved(false)
      try {
        const result = await update.mutateAsync({
          locator,
          submissionId,
          expectedRevision: response.revision,
          answers,
          confirmClearUnreachable,
        })
        if (result.status === 'CONFIRM_CLEAR_REQUIRED') {
          if (currentAnswersFingerprint.current !== submittedFingerprint) return
          setPendingClear({
            answers,
            fingerprint: submittedFingerprint,
            questionIds: result.questionIds,
          })
          return
        }

        setPendingClear(null)
        await utils.form.getOwnResponse.invalidate({ locator, submissionId })
        try {
          const freshResponse = await utils.client.form.getOwnResponse.query({
            locator,
            submissionId,
          })
          const freshFingerprint = canonicalJson(freshResponse.answers)
          const hasNewerLocalAnswers = currentAnswersFingerprint.current !== submittedFingerprint
          savedAnswersFingerprint.current = freshFingerprint
          if (!hasNewerLocalAnswers) {
            currentAnswers.current = freshResponse.answers
            currentAnswersFingerprint.current = freshFingerprint
          }
          setResponse(
            hasNewerLocalAnswers
              ? { ...freshResponse, answers: currentAnswers.current }
              : freshResponse,
          )
          setSaved(!hasNewerLocalAnswers)
        } catch {
          // The save is already committed. A policy/access change during the
          // refresh belongs to the protected server route, not to this mutation.
          router.refresh()
        }
      } catch (error) {
        const serverErrors = extractFieldErrors(error)
        if (serverErrors !== undefined) {
          setFieldErrors(serverErrors)
        } else if (errorMessage(error) === 'FORM_RESPONSE_CHANGED') {
          setGlobalError('Ответ изменился в другом окне. Обновляем актуальные данные…')
          router.refresh()
        } else {
          setGlobalError('Изменения не сохранены. Проверьте соединение и попробуйте снова.')
        }
        throw error
      } finally {
        saveInFlight.current = false
        setSaving(false)
      }
    },
    [
      locator,
      response.revision,
      router,
      submissionId,
      update,
      utils.client.form.getOwnResponse,
      utils.form.getOwnResponse,
    ],
  )

  const handleUpload = useCallback(
    async (questionId: string, file: File) => {
      setGlobalError(null)
      const ownResponseToken = response.questionTokens[questionId]
      if (!ownResponseToken) throw new Error('FORM_UPLOAD_UNAVAILABLE')
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
      body.set('ownResponseToken', ownResponseToken)
      const uploadResponse = await fetch(
        `/api/forms/${encodeURIComponent(locator)}/responses/${encodeURIComponent(submissionId)}/uploads`,
        {
          method: 'POST',
          headers: { 'x-captcha-response': captcha },
          body,
        },
      )
      if (!uploadResponse.ok) throw new Error('FORM_UPLOAD_FAILED')
      const result = (await uploadResponse.json()) as {
        uploadToken: string
        file: { name: string }
      }
      return { token: result.uploadToken, name: result.file.name }
    },
    [executeRecaptcha, locator, response.questionTokens, submissionId],
  )

  const handleLoadPickerOptions = useCallback(
    (questionId: string, query: string, cursor?: string) => {
      const ownResponseToken = response.questionTokens[questionId]
      if (!ownResponseToken) return Promise.reject(new Error('FORM_PICKER_UNAVAILABLE'))
      return utils.client.form.listOwnResponsePickerOptions.query({
        locator,
        submissionId,
        questionId,
        ownResponseToken,
        query: query || undefined,
        cursor,
        limit: 50,
      })
    },
    [
      locator,
      response.questionTokens,
      submissionId,
      utils.client.form.listOwnResponsePickerOptions,
    ],
  )

  const handleAnswersChange = useCallback((answers: Record<string, unknown>) => {
    const fingerprint = canonicalJson(answers)
    currentAnswers.current = answers
    currentAnswersFingerprint.current = fingerprint
    if (fingerprint === savedAnswersFingerprint.current) return
    setSaved(false)
    setPendingClear((current) =>
      current !== null && current.fingerprint !== fingerprint ? null : current,
    )
  }, [])

  return (
    <>
      {globalError ? (
        <Alert severity="error" role="alert" sx={{ borderRadius: 0 }}>
          {globalError}
        </Alert>
      ) : null}
      {saved ? (
        <Alert severity="success" role="status" sx={{ borderRadius: 0 }}>
          Изменения сохранены
        </Alert>
      ) : null}
      {pendingClear ? (
        <Alert
          severity="warning"
          role="alert"
          sx={{ borderRadius: 0 }}
          action={
            <Button
              color="inherit"
              size="small"
              disabled={saving}
              onClick={() => void save(pendingClear.answers, true).catch(() => {})}
            >
              Очистить и сохранить
            </Button>
          }
        >
          Из-за изменения ветки будут очищены поля:{' '}
          {pendingClear.questionIds
            .map((questionId) => questionLabels.get(questionId) ?? 'Поле для заполнения')
            .join(', ')}
        </Alert>
      ) : null}
      <FormRenderer
        key={response.revision}
        version={response.version}
        mode="public"
        initialAnswers={response.answers}
        initialFileNames={initialFileNames}
        initialPickerOptions={Object.fromEntries(
          Object.entries(response.selectedOptions).map(([questionId, options]) => [
            questionId,
            options.map(({ value, label }) => ({ id: value, label })),
          ]),
        )}
        unavailableQuestionIds={unavailableQuestionIds}
        readOnly={response.status === 'VIEW'}
        submissionDisabled={saving}
        draftControls={false}
        submitButtonText="Сохранить изменения"
        footerText={response.status === 'VIEW' ? 'Только просмотр' : 'Можно изменить свой ответ'}
        serverFieldErrors={fieldErrors}
        onAnswersChange={response.status === 'EDIT' ? handleAnswersChange : undefined}
        onSubmit={response.status === 'EDIT' ? ({ answers }) => save(answers, false) : undefined}
        onUpload={response.status === 'EDIT' ? handleUpload : undefined}
        onLoadPickerOptions={response.status === 'EDIT' ? handleLoadPickerOptions : undefined}
      />
    </>
  )
}
