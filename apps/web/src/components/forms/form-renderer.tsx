'use client'

import { useMemo, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Box, Button, Divider, Stack, Typography } from '@repo/ui/components'
import {
  buildFormAnswerSchema,
  evaluateFormPath,
  toPublicFormVersion,
  type FormAnswerEnvelope,
  type FormVersionDocument,
  type PublicFormVersion,
} from '@repo/domain/database/forms'

import { FormField } from './form-field'
import { FormSectionMap } from './form-section-map'

interface FormRendererProps {
  readonly version: FormVersionDocument | PublicFormVersion
  readonly mode: 'preview' | 'public'
  readonly submissionDisabled?: boolean
  readonly onSubmit?: (values: FormAnswerEnvelope) => Promise<void> | void
}

function isStoredVersion(
  version: FormVersionDocument | PublicFormVersion,
): version is FormVersionDocument {
  return version.questions.some((question) => 'property' in question)
}

export function FormRenderer({ version, mode, submissionDisabled, onSubmit }: FormRendererProps) {
  const publicVersion = useMemo(
    () => (isStoredVersion(version) ? toPublicFormVersion(version) : version),
    [version],
  )
  const answerSchema = useMemo(() => buildFormAnswerSchema(publicVersion), [publicVersion])
  const resolver = useMemo(
    () => zodResolver(answerSchema as never) as Resolver<FormAnswerEnvelope>,
    [answerSchema],
  )
  const [activeSectionId, setActiveSectionId] = useState(publicVersion.firstSectionId)
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormAnswerEnvelope>({
    resolver,
    defaultValues: { answers: {} },
  })
  const watchedAnswers = watch('answers')
  const answers = useMemo(() => watchedAnswers ?? {}, [watchedAnswers])
  const questionsById = useMemo(
    () => new Map(publicVersion.questions.map((question) => [question.id, question])),
    [publicVersion.questions],
  )
  const visibleIds = useMemo(() => {
    try {
      return new Set(evaluateFormPath(publicVersion, answers).visibleQuestionIds)
    } catch {
      return new Set(publicVersion.questions.map(({ id }) => id))
    }
  }, [answers, publicVersion])
  const sections = publicVersion.sections
  const activeSection =
    sections.find(({ id }) => id === activeSectionId) ??
    sections.find(({ id }) => id === publicVersion.firstSectionId) ??
    sections[0]!

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(async (values) => onSubmit?.(values))}
      noValidate
      sx={{
        width: '100%',
        minHeight: '100%',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(150px, 0.32fr) minmax(0, 1fr)' },
        background: (theme) =>
          `linear-gradient(110deg, ${theme.palette.action.hover} 0%, transparent 42%)`,
      }}
    >
      <Box
        sx={{
          display: { xs: 'none', md: 'block' },
          px: 2,
          py: 4,
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="overline" color="text.secondary">
          Маршрут
        </Typography>
        <FormSectionMap
          sections={sections}
          activeSectionId={activeSection.id}
          onSelect={setActiveSectionId}
        />
      </Box>
      <Stack sx={{ px: { xs: 2.5, sm: 5, lg: 7 }, py: { xs: 4, md: 6 }, minWidth: 0 }}>
        <Box sx={{ maxWidth: 680, width: '100%', mx: 'auto' }}>
          {publicVersion.presentation.organizationName ? (
            <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800 }}>
              {publicVersion.presentation.organizationName}
            </Typography>
          ) : null}
          <Typography
            component="h1"
            variant="h4"
            sx={{ fontWeight: 800, letterSpacing: '-0.025em' }}
          >
            {publicVersion.presentation.title}
          </Typography>
          {publicVersion.presentation.description ? (
            <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 620 }}>
              {publicVersion.presentation.description}
            </Typography>
          ) : null}
          <Divider sx={{ my: 3 }} />
          <Typography variant="overline" color="text.secondary">
            Раздел {sections.findIndex(({ id }) => id === activeSection.id) + 1} из{' '}
            {sections.length}
          </Typography>
          <Typography component="h2" variant="h5" sx={{ mt: 0.25, fontWeight: 750 }}>
            {activeSection.title}
          </Typography>
          {activeSection.description ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {activeSection.description}
            </Typography>
          ) : null}
          <Stack spacing={2.5} sx={{ mt: 3 }}>
            {activeSection.questionIds.map((questionId) => {
              const question = questionsById.get(questionId)
              return question && visibleIds.has(question.id) ? (
                <FormField
                  key={question.id}
                  question={question}
                  control={control}
                  register={register}
                  errors={errors}
                  disabled={submissionDisabled}
                />
              ) : null
            })}
          </Stack>
          <Stack
            direction="row"
            sx={{ mt: 4, justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Typography variant="caption" color="text.secondary">
              {mode === 'preview' ? 'Предпросмотр · ответы не сохраняются' : 'AnyNote Forms'}
            </Typography>
            <Button
              type="submit"
              variant="contained"
              disabled={submissionDisabled || isSubmitting}
              sx={{ minHeight: 44, px: 3, borderRadius: 999 }}
            >
              {publicVersion.presentation.submitButtonText}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Box>
  )
}
