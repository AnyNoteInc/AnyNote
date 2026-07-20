'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Divider, LinearProgress, Stack, Typography } from '@repo/ui/components'
import {
  buildFormAnswerSchema,
  applyDefaultAnswers,
  evaluateFormPath,
  projectReachableAnswers,
  toPublicFormVersion,
  type FormVersionDocument,
  type PublicFormVersion,
} from '@repo/domain/database/forms'

import { FormEnding } from './form-ending'
import { FormField, formFieldError, type FormAnswerValues } from './form-field'
import type { FormPickerLoader, FormPickerOption } from './form-internal-picker'
import {
  decodeFormFieldKey,
  encodeFormFieldKey,
  encodeFormVersionQuestionIds,
} from './form-field-key'
import { FormSectionMap } from './form-section-map'
import type { FormUploadHandler } from './form-upload-field'

const NO_UNAVAILABLE_QUESTIONS: readonly string[] = []

export interface FormRendererProps {
  readonly version: FormVersionDocument | PublicFormVersion
  readonly mode: 'preview' | 'public'
  readonly submissionDisabled?: boolean
  readonly onSubmit?: (values: FormAnswerValues) => Promise<void> | void
  readonly previewLocation?: { kind: 'SECTION' | 'ENDING'; id: string }
  readonly onPreviewLocationChange?: (location: { kind: 'SECTION'; id: string }) => void
  readonly initialAnswers?: Record<string, unknown>
  readonly onAnswersChange?: (answers: Record<string, unknown>) => void
  readonly serverFieldErrors?: Record<string, readonly string[]>
  readonly successEndingId?: string
  readonly onReset?: () => void
  readonly onUpload?: FormUploadHandler
  readonly onLoadPickerOptions?: FormPickerLoader
  readonly readOnly?: boolean
  readonly draftControls?: boolean
  readonly submitButtonText?: string
  readonly footerText?: string
  readonly unavailableQuestionIds?: readonly string[]
  readonly initialFileNames?: Readonly<Record<string, string>>
  readonly initialPickerOptions?: Readonly<Record<string, readonly FormPickerOption[]>>
  readonly submitAgainPath?: string
  readonly homePath?: string
}

function isStoredVersion(
  version: FormVersionDocument | PublicFormVersion,
): version is FormVersionDocument {
  return version.questions.some((question) => 'property' in question)
}

function decodeAnswers(answers: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!answers) return {}
  return Object.fromEntries(
    Object.entries(answers).map(([fieldKey, value]) => [decodeFormFieldKey(fieldKey), value]),
  )
}

function encodeAnswers(
  answers: Record<string, unknown> | undefined,
  validQuestionIds: ReadonlySet<string>,
): Record<string, unknown> {
  if (!answers) return {}
  return Object.fromEntries(
    Object.entries(answers)
      .filter(([questionId]) => validQuestionIds.has(questionId))
      .map(([questionId, value]) => [encodeFormFieldKey(questionId), value]),
  )
}

function coverStyles(cover: PublicFormVersion['presentation']['cover']) {
  if (!cover || cover.kind === 'image') return undefined
  return cover.kind === 'gradient' ? { background: cover.value } : { backgroundColor: cover.value }
}

function isDraftAnswer(value: unknown, preserveFalse: boolean): boolean {
  if (value === undefined || value === null || value === '') return false
  if (value === false) return preserveFalse
  return !Array.isArray(value) || value.length > 0
}

function emptyEncodedAnswers(version: PublicFormVersion): Record<string, unknown> {
  return Object.fromEntries(
    version.questions.map((question) => {
      const input = question.input
      const empty =
        input.kind === 'FILE' ||
        input.kind === 'PERSON' ||
        input.kind === 'RELATION' ||
        input.kind === 'MULTI_CHOICE'
          ? []
          : input.kind === 'CHECKBOX'
            ? undefined
            : input.kind === 'NUMBER'
              ? null
              : ''
      return [encodeFormFieldKey(question.id), empty]
    }),
  )
}

interface ValidationResult {
  ok: boolean
  invalidQuestionIds: readonly string[]
}

function validateAnswersWithDefaults(
  answerSchema: ReturnType<typeof buildFormAnswerSchema>,
  answerValues: Record<string, unknown>,
  questionIds: readonly string[],
  clearErrors: (names: ReadonlyArray<`answers.${string}`>) => void,
  setError: (name: `answers.${string}`, options: { message: string; type: string }) => void,
): ValidationResult {
  const invalidByQuestion = new Set<string>()
  const messageByQuestion = new Map<string, string>()
  const checks = new Set(questionIds)
  const encodedAnswers = encodeAnswers(answerValues, checks)
  const parsed = answerSchema.safeParse({ answers: encodedAnswers })
  const issues = parsed.success ? [] : parsed.error.issues

  if (issues.length > 0) {
    for (const issue of issues) {
      const path = Array.isArray(issue.path) ? issue.path : []
      if (path.length < 2 || path[0] !== 'answers' || typeof path[1] !== 'string') continue
      const encodedQuestionId = path[1]
      let questionId: string
      try {
        questionId = decodeFormFieldKey(encodedQuestionId)
      } catch {
        continue
      }
      if (!checks.has(questionId) || messageByQuestion.has(questionId)) continue
      const message = typeof issue.message === 'string' ? issue.message : 'Ошибка валидации ответа'
      invalidByQuestion.add(questionId)
      messageByQuestion.set(questionId, message)
    }
  }

  clearErrors(Array.from(checks, (questionId): `answers.${string}` => `answers.${encodeFormFieldKey(questionId)}`))

  for (const [questionId, message] of messageByQuestion) {
    setError(`answers.${encodeFormFieldKey(questionId)}` as `answers.${string}`, {
      type: 'schema',
      message,
    })
  }

  return { ok: invalidByQuestion.size === 0, invalidQuestionIds: [...invalidByQuestion] }
}

export function FormRenderer({
  version,
  mode,
  submissionDisabled,
  onSubmit,
  previewLocation,
  onPreviewLocationChange,
  initialAnswers,
  onAnswersChange,
  serverFieldErrors,
  successEndingId,
  onReset,
  onUpload,
  onLoadPickerOptions,
  readOnly = false,
  draftControls = mode === 'public',
  submitButtonText,
  footerText,
  unavailableQuestionIds = NO_UNAVAILABLE_QUESTIONS,
  initialFileNames,
  initialPickerOptions,
  submitAgainPath,
  homePath,
}: FormRendererProps) {
  const publicVersion = useMemo(
    () => (isStoredVersion(version) ? toPublicFormVersion(version) : version),
    [version],
  )
  const questionIds = useMemo(
    () => new Set(publicVersion.questions.map((question) => question.id)),
    [publicVersion.questions],
  )
  const unavailableIds = useMemo(() => new Set(unavailableQuestionIds), [unavailableQuestionIds])
  const clientVersion = useMemo(
    () => ({
      ...publicVersion,
      questions: publicVersion.questions.map((question) =>
        unavailableIds.has(question.id) ? { ...question, required: false } : question,
      ),
    }),
    [publicVersion, unavailableIds],
  )
  const encodedVersion = useMemo(() => encodeFormVersionQuestionIds(clientVersion), [clientVersion])
  const answerSchema = useMemo(() => buildFormAnswerSchema(encodedVersion), [encodedVersion])
  const resolver = useMemo(
    () => zodResolver(answerSchema as never) as Resolver<FormAnswerValues>,
    [answerSchema],
  )
  const encodedInitialAnswers = useMemo(
    () => encodeAnswers(initialAnswers, questionIds),
    // Initial answers are intentionally read once. Parent rerenders must not erase in-progress input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [initialAnswerIds] = useState(() => new Set(Object.keys(initialAnswers ?? {})))
  const [internalLocation, setInternalLocation] = useState<{
    kind: 'SECTION' | 'ENDING'
    id: string
  }>({ kind: 'SECTION', id: publicVersion.firstSectionId })
  const [submitting, setSubmitting] = useState(false)
  const [pendingUploadIds, setPendingUploadIds] = useState<ReadonlySet<string>>(() => new Set())
  const serverErrorKeys = useRef<string[]>([])
  const location = successEndingId
    ? ({ kind: 'ENDING', id: successEndingId } as const)
    : (previewLocation ?? internalLocation)
  const {
    control,
    register,
    trigger,
    reset,
    setError,
    setFocus,
    clearErrors,
    getFieldState,
    formState: { dirtyFields, errors },
  } = useForm<FormAnswerValues>({
    resolver,
    criteriaMode: 'all',
    mode: 'onBlur',
    shouldUnregister: false,
    defaultValues: { answers: encodedInitialAnswers },
  })
  const watchedAnswers = useWatch({ control, name: 'answers' })
  const answers = useMemo(() => decodeAnswers(watchedAnswers), [watchedAnswers])
  const answersWithDefaults = useMemo(
    () => applyDefaultAnswers(publicVersion, answers),
    [answers, publicVersion],
  )
  const questionsById = useMemo(
    () => new Map(publicVersion.questions.map((question) => [question.id, question])),
    [publicVersion.questions],
  )
  const path = useMemo(() => {
    try {
      return evaluateFormPath(publicVersion, answersWithDefaults)
    } catch {
      return {
        sectionIds: publicVersion.sections.map((section) => section.id),
        visibleQuestionIds: publicVersion.questions.map((question) => question.id),
        endingId: publicVersion.endings[0]?.id ?? '',
      }
    }
  }, [answersWithDefaults, publicVersion])
  const visibleIds = useMemo(() => new Set(path.visibleQuestionIds), [path.visibleQuestionIds])
  const navigableSections = useMemo(() => {
    if (mode === 'preview') return publicVersion.sections
    const reachable = new Set(path.sectionIds)
    return publicVersion.sections.filter((section) => reachable.has(section.id))
  }, [mode, path.sectionIds, publicVersion.sections])
  const activeSection =
    publicVersion.sections.find(({ id }) => location.kind === 'SECTION' && id === location.id) ??
    publicVersion.sections.find(({ id }) => id === publicVersion.firstSectionId) ??
    publicVersion.sections[0]!
  const activeEnding =
    location.kind === 'ENDING'
      ? publicVersion.endings.find(({ id }) => id === location.id)
      : undefined
  const activePathIndex = path.sectionIds.indexOf(activeSection.id)
  const nextSectionId = activePathIndex >= 0 ? path.sectionIds[activePathIndex + 1] : undefined
  const previousSectionId = activePathIndex > 0 ? path.sectionIds[activePathIndex - 1] : undefined
  const activeVisibleQuestionIds = activeSection.questionIds.filter(
    (id) => visibleIds.has(id) && !unavailableIds.has(id),
  )
  const errorItems = publicVersion.questions.flatMap((question) => {
    if (unavailableIds.has(question.id)) return []
    const message = formFieldError(errors, encodeFormFieldKey(question.id))
    return message ? [{ question, message }] : []
  })
  const draftAnswers = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(answers).filter(([questionId, value]) => {
          if (unavailableIds.has(questionId)) return false
          const encodedId = encodeFormFieldKey(questionId)
          const dirty = Boolean(dirtyFields.answers?.[encodedId])
          return isDraftAnswer(value, dirty || initialAnswerIds.has(questionId))
        }),
      ),
    [answers, dirtyFields.answers, initialAnswerIds, unavailableIds],
  )
  const hasAnswers = Object.keys(draftAnswers).length > 0
  const uploadsPending = pendingUploadIds.size > 0

  function selectSection(sectionId: string) {
    const next = { kind: 'SECTION' as const, id: sectionId }
    setInternalLocation(next)
    onPreviewLocationChange?.(next)
  }

  function focusQuestion(questionId: string) {
    const question = questionsById.get(questionId)
    if (!question) return
    selectSection(question.sectionId)
    globalThis.setTimeout(() => setFocus(`answers.${encodeFormFieldKey(questionId)}`), 0)
  }

  useEffect(() => {
    onAnswersChange?.(draftAnswers)
  }, [draftAnswers, onAnswersChange])

  useEffect(() => {
    if (
      location.kind !== 'SECTION' ||
      mode === 'preview' ||
      path.sectionIds.includes(location.id)
    ) {
      return
    }
    selectSection(path.sectionIds.at(-1) ?? publicVersion.firstSectionId)
    // Navigation callback is intentionally excluded: this effect follows the evaluated branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, mode, path.sectionIds, publicVersion.firstSectionId])

  useEffect(() => {
    if (serverErrorKeys.current.length > 0) {
      clearErrors(serverErrorKeys.current.map((key) => `answers.${key}` as const))
    }
    const entries = Object.entries(serverFieldErrors ?? {}).filter(
      ([questionId, messages]) => questionIds.has(questionId) && messages.length > 0,
    )
    serverErrorKeys.current = entries.map(([questionId]) => encodeFormFieldKey(questionId))
    for (const [questionId, messages] of entries) {
      setError(`answers.${encodeFormFieldKey(questionId)}`, {
        type: 'server',
        message: messages[0],
        types: Object.fromEntries(messages.map((message, index) => [`server.${index}`, message])),
      })
    }
    const firstQuestionId = entries[0]?.[0]
    if (firstQuestionId) focusQuestion(firstQuestionId)
    // Focus helpers are intentionally driven only by a new server error payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearErrors, questionIds, serverFieldErrors, setError])

  async function goNext() {
    if (uploadsPending) return
    const projected = projectReachableAnswers(publicVersion, answersWithDefaults)
    const { ok, invalidQuestionIds } = validateAnswersWithDefaults(
      answerSchema,
      projected,
      activeVisibleQuestionIds,
      (names) => clearErrors(names),
      (name, options) => setError(name, options),
    )

    if (!ok) {
      const questionId = activeVisibleQuestionIds.find((id) => invalidQuestionIds.includes(id))
      if (questionId) focusQuestion(questionId)
      return
    }

    const paths = activeVisibleQuestionIds.map(
      (questionId): `answers.${string}` => `answers.${encodeFormFieldKey(questionId)}`,
    )
    const valid = await trigger(paths, { shouldFocus: true })
    if (!valid) {
      const questionId = activeVisibleQuestionIds.find(
        (id) => getFieldState(`answers.${encodeFormFieldKey(id)}`).invalid,
      )
      if (questionId) focusQuestion(questionId)
      return
    }
    if (nextSectionId) selectSection(nextSectionId)
  }

  async function submitReachableAnswers() {
    if (uploadsPending) return
    const projected = projectReachableAnswers(publicVersion, answersWithDefaults)
    const { ok, invalidQuestionIds } = validateAnswersWithDefaults(
      answerSchema,
      projected,
      path.visibleQuestionIds,
      (names) => clearErrors(names),
      (name, options) => setError(name, options),
    )
    if (!ok) {
      const questionId = path.visibleQuestionIds.find((id) => invalidQuestionIds.includes(id))
      if (questionId) focusQuestion(questionId)
      return
    }
    const submitPaths = path.visibleQuestionIds.map(
      (questionId): `answers.${string}` => `answers.${encodeFormFieldKey(questionId)}`,
    )
    const filtered = Object.fromEntries(
      Object.entries(projected).filter(([questionId]) => !unavailableIds.has(questionId)),
    )
    const valid = await trigger(submitPaths, { shouldFocus: true })
    if (!valid) {
      const questionId = path.visibleQuestionIds.find(
        (id) => getFieldState(`answers.${encodeFormFieldKey(id)}`).invalid,
      )
      if (questionId) focusQuestion(questionId)
      return
    }
    setSubmitting(true)
    try {
      await onSubmit?.({ answers: filtered })
    } catch {
      // The page-level owner maps transport/domain errors back through serverFieldErrors.
    } finally {
      setSubmitting(false)
    }
  }

  function resetDraft() {
    reset({ answers: emptyEncodedAnswers(publicVersion) })
    selectSection(publicVersion.firstSectionId)
    onReset?.()
  }

  const cover = publicVersion.presentation.cover
  const currentProgress = Math.max(
    0,
    navigableSections.findIndex(({ id }) => id === activeSection.id),
  )
  const progressValue = navigableSections.length
    ? ((currentProgress + 1) / navigableSections.length) * 100
    : 100

  if (activeEnding && mode === 'public') {
    return (
      <Box
        component="form"
        onSubmit={(event) => event.preventDefault()}
        noValidate
        sx={{ width: '100%', minHeight: '100vh', bgcolor: 'background.default' }}
      >
        {cover ? (
          cover.kind === 'image' ? (
            <Box
              component="img"
              src={cover.value}
              alt=""
              referrerPolicy="no-referrer"
              sx={{
                display: 'block',
                width: '100%',
                height: { xs: 128, md: 210 },
                objectFit: 'cover',
              }}
            />
          ) : (
            <Box
              aria-hidden
              sx={{ width: '100%', height: { xs: 128, md: 210 }, ...coverStyles(cover) }}
            />
          )
        ) : null}
        <Box
          sx={{
            minHeight: cover ? 'calc(100vh - 128px)' : '100vh',
            display: 'grid',
            background: (theme) =>
              `linear-gradient(112deg, ${theme.palette.action.hover} 0%, transparent 38%)`,
            justifyItems: 'center',
          }}
        >
          <Stack
            sx={{
              width: '100%',
              px: { xs: 2.5, sm: 5, lg: 8 },
              py: { xs: 3, md: 6 },
            }}
          >
            <FormEnding
              ending={activeEnding}
              submitAgainPath={submitAgainPath}
              homePath={homePath}
            />
          </Stack>
        </Box>
      </Box>
    )
  }

  return (
    <Box
      component="form"
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !nextSectionId || submissionDisabled || uploadsPending) {
          return
        }
        const target = event.target
        if (!(target instanceof HTMLInputElement)) return
        if (!['text', 'email', 'tel', 'url', 'number'].includes(target.type)) {
          return
        }
        if (target.dataset.formPickerSearch === 'true') return
        event.preventDefault()
        void goNext()
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (submissionDisabled || readOnly || uploadsPending) return
        if (nextSectionId) void goNext()
        else void submitReachableAnswers()
      }}
      noValidate
      sx={{ width: '100%', minHeight: '100vh', bgcolor: 'background.default' }}
    >
      {cover ? (
        cover.kind === 'image' ? (
          <Box
            component="img"
            src={cover.value}
            alt=""
            referrerPolicy="no-referrer"
            sx={{
              display: 'block',
              width: '100%',
              height: { xs: 128, md: 210 },
              objectFit: 'cover',
            }}
          />
        ) : (
          <Box
            aria-hidden
            sx={{ width: '100%', height: { xs: 128, md: 210 }, ...coverStyles(cover) }}
          />
        )
      ) : null}

      <Box
        sx={{
          minHeight: cover ? 'auto' : '100%',
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: mode === 'preview' ? 'minmax(190px, 0.34fr) minmax(0, 1fr)' : '1fr',
          },
          background: (theme) =>
            `linear-gradient(112deg, ${theme.palette.action.hover} 0%, transparent 38%)`,
        }}
      >
        {mode === 'preview' ? (
          <Box
            component="aside"
            sx={{
              display: { xs: 'none', md: 'block' },
              px: 2.5,
              py: 5,
              borderRight: 1,
              borderColor: 'divider',
            }}
          >
            <Typography variant="overline" color="text.secondary">
              Маршрут
            </Typography>
            <FormSectionMap
              sections={navigableSections}
              activeSectionId={activeEnding ? undefined : activeSection.id}
              onSelect={(sectionId) => {
                const targetIndex = path.sectionIds.indexOf(sectionId)
                if (mode === 'preview' || targetIndex <= activePathIndex) selectSection(sectionId)
              }}
            />
          </Box>
        ) : null}

        <Stack sx={{ px: { xs: 2.5, sm: 5, lg: 8 }, py: { xs: 3, md: 6 }, minWidth: 0 }}>
          <Box sx={{ width: '100%', mx: 'auto' }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
              {publicVersion.presentation.icon ? (
                <Typography aria-hidden sx={{ fontSize: 28 }}>
                  {publicVersion.presentation.icon}
                </Typography>
              ) : null}
              {publicVersion.presentation.organizationName ? (
                <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800 }}>
                  {publicVersion.presentation.organizationName}
                </Typography>
              ) : null}
            </Stack>
            <Typography
              component="h1"
              variant="h4"
              sx={{ fontWeight: 800, letterSpacing: '-0.025em' }}
            >
              {publicVersion.presentation.title}
            </Typography>
            {publicVersion.presentation.description ? (
              <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 640 }}>
                {publicVersion.presentation.description}
              </Typography>
            ) : null}
            <Divider sx={{ my: 3 }} />

            {activeEnding ? (
              <FormEnding ending={activeEnding} preview={mode === 'preview'} />
            ) : (
              <>
                <Stack spacing={0.75} sx={{ display: { xs: 'flex', md: 'none' }, mb: 2.5 }}>
                  <LinearProgress
                    variant="determinate"
                    value={progressValue}
                    aria-label={`Прогресс формы: ${Math.round(progressValue)}%`}
                    sx={{ height: 5, borderRadius: 99 }}
                  />
                </Stack>
                <Typography variant="overline" color="text.secondary">
                  Раздел {Math.max(0, currentProgress) + 1} из{' '}
                  {Math.max(1, navigableSections.length)}
                </Typography>
                <Typography component="h2" variant="h5" sx={{ mt: 0.25, fontWeight: 750 }}>
                  {activeSection.title}
                </Typography>
                {activeSection.description ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                    {activeSection.description}
                  </Typography>
                ) : null}

                {errorItems.length > 0 ? (
                  <Box
                    role="alert"
                    aria-labelledby="form-error-summary-title"
                    sx={{ mt: 2.5, p: 2, border: 1, borderColor: 'error.main', borderRadius: 2 }}
                  >
                    <Typography id="form-error-summary-title" sx={{ fontWeight: 750 }}>
                      Проверьте ответы
                    </Typography>
                    <Stack component="ul" sx={{ pl: 2.5, my: 0.75 }}>
                      {errorItems.map(({ question, message }) => (
                        <Box component="li" key={question.id}>
                          <Button
                            type="button"
                            size="small"
                            onClick={() => focusQuestion(question.id)}
                            sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                          >
                            {question.label}: {message}
                          </Button>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ) : null}

                <Stack spacing={3} sx={{ mt: 3.5 }}>
                  {activeSection.questionIds.map((questionId) => {
                    const question = questionsById.get(questionId)
                    if (!question || !visibleIds.has(question.id)) return null
                    if (unavailableIds.has(question.id)) {
                      return (
                        <Box
                          key={question.id}
                          role="note"
                          sx={{ borderLeft: 3, borderColor: 'divider', pl: 2, py: 0.5 }}
                        >
                          <Typography sx={{ fontWeight: 650 }}>{question.label}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            Это поле больше недоступно и не будет изменено.
                          </Typography>
                        </Box>
                      )
                    }
                    return (
                      <FormField
                        key={question.id}
                        question={question}
                        fieldKey={encodeFormFieldKey(question.id)}
                        control={control}
                        register={register}
                        errors={errors}
                        disabled={submissionDisabled || readOnly}
                        onUpload={onUpload}
                        onUploadPendingChange={(pending) =>
                          setPendingUploadIds((current) => {
                            const next = new Set(current)
                            if (pending) next.add(question.id)
                            else next.delete(question.id)
                            return next
                          })
                        }
                        onLoadPickerOptions={onLoadPickerOptions}
                        initialFileNames={initialFileNames}
                        initialPickerOptions={initialPickerOptions}
                      />
                    )
                  })}
                </Stack>

                <Stack
                  direction={{ xs: 'column-reverse', sm: 'row' }}
                  sx={{
                    mt: 4,
                    gap: 1.5,
                    justifyContent: 'space-between',
                    alignItems: { sm: 'center' },
                  }}
                >
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    {previousSectionId ? (
                      <Button
                        type="button"
                        variant="text"
                        onClick={() => selectSection(previousSectionId)}
                      >
                        Назад
                      </Button>
                    ) : null}
                    {mode === 'public' && draftControls && hasAnswers ? (
                      <Button type="button" color="inherit" onClick={resetDraft}>
                        Сбросить черновик
                      </Button>
                    ) : null}
                  </Stack>
                  {nextSectionId ? (
                    <Button
                      type="button"
                      variant="contained"
                      disabled={submissionDisabled || uploadsPending}
                      onClick={() => void goNext()}
                      sx={{ minHeight: 44, px: 3, borderRadius: 999 }}
                    >
                      Далее
                    </Button>
                  ) : readOnly ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      Только просмотр
                    </Typography>
                  ) : (
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={submissionDisabled || submitting || uploadsPending}
                      sx={{
                        minHeight: 44,
                        px: 3,
                        borderRadius: 999,
                        ...(publicVersion.presentation.submitButtonColor
                          ? {
                              bgcolor: publicVersion.presentation.submitButtonColor,
                              '&:hover': { bgcolor: publicVersion.presentation.submitButtonColor },
                            }
                          : {}),
                      }}
                    >
                      {submitting
                        ? 'Отправляем…'
                        : (submitButtonText ?? publicVersion.presentation.submitButtonText)}
                    </Button>
                  )}
                </Stack>
                <Stack spacing={0.5} sx={{ mt: 4 }}>
                  <Typography variant="caption" color="text.secondary">
                    {footerText ??
                      (mode === 'preview'
                        ? 'Предпросмотр · ответы не сохраняются'
                        : readOnly
                          ? 'Показаны текущие значения сохранённого ответа.'
                          : draftControls
                            ? 'Черновик хранится только в этом браузере. На общем устройстве его смогут увидеть другие.'
                            : 'Изменения сохранятся только после отправки.')}
                  </Typography>
                  {mode === 'public' && !readOnly ? (
                    <Typography variant="caption" color="text.secondary">
                      Ответы будут сохранены только после отправки формы.
                    </Typography>
                  ) : null}
                  {!publicVersion.presentation.hideAnyNoteBranding ? (
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      Создано в AnyNote
                    </Typography>
                  ) : null}
                </Stack>
              </>
            )}
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}
