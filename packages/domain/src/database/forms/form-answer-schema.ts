import { z } from 'zod'

import {
  evaluateFormPath,
  isFormQuestionInputCompatible,
  isReservedFormAnswerKey,
  type EvaluatedFormPath,
  type PublicFormQuestion,
  type PublicFormVersion,
} from './form-graph.ts'
import {
  MAX_FORM_QUESTIONS,
  formPropertyTypeSchema,
  formQuestionSchema,
  formVersionDocumentSchema,
  parseFormVersionDocument,
  type FormVersionDocument,
} from './form-document.ts'

export type FormAnswerEnvelope = {
  answers: Record<string, unknown>
}

const ANSWER_MAX_STRING_LENGTH = 2_048
const EMAIL_MAX_LENGTH = 320
const PHONE_MAX_LENGTH = 32
const LEASE_TOKEN_MAX_LENGTH = 4_096
const OPAQUE_ID_MAX_LENGTH = 512

export const publicFormQuestionSchema: z.ZodType<PublicFormQuestion> = formQuestionSchema
  .omit({ property: true })
  .extend({ valueType: z.union([formPropertyTypeSchema, z.literal('TITLE')]) })
  .strict()

export const publicFormVersionSchema: z.ZodType<PublicFormVersion> = formVersionDocumentSchema
  .omit({ questions: true })
  .extend({ questions: z.array(publicFormQuestionSchema).min(1).max(MAX_FORM_QUESTIONS) })
  .strict()

export const toPublicFormVersion = (stored: FormVersionDocument): PublicFormVersion => {
  const parsed = parseFormVersionDocument(stored)
  const { schemaVersion, firstSectionId, presentation, sections, questions, transitions, endings } =
    parsed

  return publicFormVersionSchema.parse({
    schemaVersion,
    firstSectionId,
    presentation,
    sections,
    questions: questions.map(({ property, ...question }) => ({
      ...question,
      valueType: property.kind === 'TITLE' ? 'TITLE' : property.propertyType,
    })),
    transitions,
    endings,
  })
}

const isSupportedEmptyAnswer = (question: PublicFormQuestion, value: unknown): boolean => {
  if (value === undefined || value === null) return true

  switch (question.input.kind) {
    case 'TEXT':
    case 'SINGLE_CHOICE':
    case 'DATE':
    case 'URL':
    case 'EMAIL':
    case 'PHONE':
    case 'PAGE_LINK':
      return value === ''
    case 'MULTI_CHOICE':
    case 'FILE':
    case 'PERSON':
    case 'RELATION':
      return Array.isArray(value) && value.length === 0
    case 'NUMBER':
    case 'CHECKBOX':
      return false
  }
}

const addInvalidIssue = (context: z.RefinementCtx, message: string): void => {
  context.addIssue({ code: 'custom', message })
}

const hasUniqueStrings = (values: string[]): boolean => new Set(values).size === values.length

const isOpaqueString = (value: unknown, maxLength = OPAQUE_ID_MAX_LENGTH): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  value.trim() === value &&
  !/\p{Cc}/u.test(value)

const isIsoDate = (value: string): boolean => z.iso.date().safeParse(value).success

const isOffsetDateTime = (value: string): boolean =>
  z.iso.datetime({ offset: true }).safeParse(value).success

const isHttpUrl = (value: string): boolean => {
  if (
    value.length > ANSWER_MAX_STRING_LENGTH ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value) ||
    /%(?![0-9a-f]{2})/iu.test(value)
  ) {
    return false
  }

  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

const isConservativePhone = (value: string): boolean => {
  if (value.length > PHONE_MAX_LENGTH || value.trim() !== value) return false
  if (!/^\+?[0-9][0-9 ()-]*$/u.test(value)) return false
  const digitCount = value.replace(/\D/gu, '').length
  return digitCount >= 7 && digitCount <= 15
}

const validateStringArray = (
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): value is string[] =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => isOpaqueString(item, maxItemLength)) &&
  hasUniqueStrings(value)

type CanonicalDecimal = {
  coefficient: bigint
  scale: number
}

const parseCanonicalDecimal = (value: number): CanonicalDecimal | undefined => {
  if (!Number.isFinite(value)) return undefined
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value.toString())
  if (match === null) return undefined

  const fraction = match[3] ?? ''
  const exponent = Number(match[4] ?? 0)
  if (!Number.isSafeInteger(exponent)) return undefined

  const sign = match[1] === '-' ? '-' : ''
  return {
    coefficient: BigInt(`${sign}${match[2]}${fraction}`),
    scale: fraction.length - exponent,
  }
}

const alignDecimal = (decimal: CanonicalDecimal, scale: number): bigint =>
  decimal.coefficient * 10n ** BigInt(scale - decimal.scale)

const isExactStepMultiple = (value: number, base: number, step: number): boolean => {
  const valueDecimal = parseCanonicalDecimal(value)
  const baseDecimal = parseCanonicalDecimal(base)
  const stepDecimal = parseCanonicalDecimal(step)
  if (
    valueDecimal === undefined ||
    baseDecimal === undefined ||
    stepDecimal === undefined ||
    stepDecimal.coefficient <= 0n
  ) {
    return false
  }

  const commonScale = Math.max(valueDecimal.scale, baseDecimal.scale, stepDecimal.scale)
  const alignedValue = alignDecimal(valueDecimal, commonScale)
  const alignedBase = alignDecimal(baseDecimal, commonScale)
  const alignedStep = alignDecimal(stepDecimal, commonScale)
  return (alignedValue - alignedBase) % alignedStep === 0n
}

const validateNonEmptyAnswer = (
  question: PublicFormQuestion,
  value: unknown,
  context: z.RefinementCtx,
): void => {
  const input = question.input

  switch (input.kind) {
    case 'TEXT': {
      if (typeof value !== 'string') return addInvalidIssue(context, 'INVALID_TEXT')
      if (input.minLength !== undefined && value.length < input.minLength) {
        addInvalidIssue(context, 'TEXT_TOO_SHORT')
      }
      if (value.length > input.maxLength) addInvalidIssue(context, 'TEXT_TOO_LONG')
      return
    }
    case 'NUMBER': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return addInvalidIssue(context, 'INVALID_NUMBER')
      }
      if (input.min !== undefined && value < input.min) addInvalidIssue(context, 'NUMBER_TOO_SMALL')
      if (input.max !== undefined && value > input.max) addInvalidIssue(context, 'NUMBER_TOO_LARGE')
      if (input.step !== undefined && !isExactStepMultiple(value, input.min ?? 0, input.step)) {
        addInvalidIssue(context, 'NUMBER_STEP_MISMATCH')
      }
      return
    }
    case 'SINGLE_CHOICE': {
      const optionIds = new Set(input.options.map(({ id }) => id))
      if (typeof value !== 'string' || !optionIds.has(value)) {
        addInvalidIssue(context, 'INVALID_OPTION_ID')
      }
      return
    }
    case 'MULTI_CHOICE': {
      const optionIds = new Set(input.options.map(({ id }) => id))
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        return addInvalidIssue(context, 'INVALID_OPTION_IDS')
      }
      if (!hasUniqueStrings(value)) addInvalidIssue(context, 'DUPLICATE_OPTION_ANSWER')
      if (value.some((item) => !optionIds.has(item))) addInvalidIssue(context, 'INVALID_OPTION_ID')
      if (input.minSelections !== undefined && value.length < input.minSelections) {
        addInvalidIssue(context, 'TOO_FEW_SELECTIONS')
      }
      if (value.length > input.maxSelections) addInvalidIssue(context, 'TOO_MANY_SELECTIONS')
      return
    }
    case 'CHECKBOX': {
      if (typeof value !== 'boolean') return addInvalidIssue(context, 'INVALID_CHECKBOX')
      if (question.required && input.consent && value !== true) {
        addInvalidIssue(context, 'CONSENT_REQUIRED')
      }
      return
    }
    case 'DATE': {
      if (
        typeof value !== 'string' ||
        (input.includeTime ? !isOffsetDateTime(value) : !isIsoDate(value))
      ) {
        addInvalidIssue(context, 'INVALID_DATE')
      }
      return
    }
    case 'URL': {
      if (typeof value !== 'string' || !isHttpUrl(value)) addInvalidIssue(context, 'INVALID_URL')
      return
    }
    case 'EMAIL': {
      if (
        typeof value !== 'string' ||
        value.length > EMAIL_MAX_LENGTH ||
        !z.email().safeParse(value).success
      ) {
        addInvalidIssue(context, 'INVALID_EMAIL')
      }
      return
    }
    case 'PHONE': {
      if (typeof value !== 'string' || !isConservativePhone(value)) {
        addInvalidIssue(context, 'INVALID_PHONE')
      }
      return
    }
    case 'FILE': {
      if (!validateStringArray(value, input.maxFiles, LEASE_TOKEN_MAX_LENGTH)) {
        return addInvalidIssue(context, 'INVALID_FILE_TOKENS')
      }
      return
    }
    case 'PERSON':
    case 'RELATION': {
      if (!validateStringArray(value, input.maxSelections, OPAQUE_ID_MAX_LENGTH)) {
        addInvalidIssue(context, 'INVALID_TARGET_IDS')
      }
      return
    }
    case 'PAGE_LINK': {
      if (!isOpaqueString(value)) addInvalidIssue(context, 'INVALID_TARGET_ID')
    }
  }
}

const buildQuestionValueSchemaWithRequired = (
  question: PublicFormQuestion,
  required: boolean,
): z.ZodType<unknown> =>
  z.unknown().superRefine((value, context) => {
    if (!isFormQuestionInputCompatible(question)) {
      addInvalidIssue(context, 'QUESTION_INPUT_TYPE_MISMATCH')
      return
    }

    if (isSupportedEmptyAnswer(question, value)) {
      if (required) addInvalidIssue(context, 'REQUIRED_ANSWER')
      return
    }

    validateNonEmptyAnswer(question, value, context)
  })

export const buildQuestionValueSchema = (
  question: PublicFormQuestion,
  options?: { required?: boolean },
): z.ZodType<unknown> =>
  buildQuestionValueSchemaWithRequired(question, options?.required ?? question.required)

const normalizeDefaultAnswer = (question: PublicFormQuestion): unknown | undefined =>
  question.defaultAnswer === undefined || isSupportedEmptyAnswer(question, question.defaultAnswer)
    ? undefined
    : buildQuestionValueSchemaWithRequired(question, false).safeParse(question.defaultAnswer)
          .success
      ? question.defaultAnswer
      : undefined

export const applyDefaultAnswers = (
  version: PublicFormVersion,
  answers: Record<string, unknown>,
): Record<string, unknown> => {
  const projected: Record<string, unknown> = { ...answers }
  for (const question of version.questions) {
    const current = projected[question.id]
    if (!isSupportedEmptyAnswer(question, current)) continue
    const next = normalizeDefaultAnswer(question)
    if (next !== undefined) projected[question.id] = next
  }
  return projected
}

type StabilizedFormAnswers = {
  answers: Record<string, unknown>
  path: EvaluatedFormPath
}

const stabilizeReachableAnswers = (
  version: PublicFormVersion,
  answers: Record<string, unknown>,
): StabilizedFormAnswers => {
  let projected = { ...answers }
  const maximumIterations = Object.keys(projected).length + 1

  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const path = evaluateFormPath(version, projected)
    const visibleQuestionIds = new Set(path.visibleQuestionIds)
    const nextProjection = Object.fromEntries(
      Object.entries(projected).filter(([questionId]) => visibleQuestionIds.has(questionId)),
    )

    if (Object.keys(nextProjection).length === Object.keys(projected).length) {
      return { answers: projected, path }
    }

    projected = nextProjection
  }

  throw new Error('FORM_ANSWER_REACHABILITY_DID_NOT_STABILIZE')
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const inspectRawRecord = (
  value: unknown,
  path: (string | number)[],
  context: z.RefinementCtx,
): void => {
  if (!isObjectRecord(value)) return

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    context.addIssue({ code: 'custom', path, message: 'INVALID_OBJECT_PROTOTYPE' })
  }

  for (const key of Object.keys(value)) {
    if (isReservedFormAnswerKey(key)) {
      context.addIssue({ code: 'custom', path: [...path, key], message: 'DANGEROUS_OBJECT_KEY' })
    }
  }
}

const rawFormAnswerEnvelopeSchema = z.unknown().superRefine((value, context) => {
  inspectRawRecord(value, [], context)
  if (isObjectRecord(value) && Object.prototype.hasOwnProperty.call(value, 'answers')) {
    inspectRawRecord(value['answers'], ['answers'], context)
  }
})

export const buildFormAnswerSchema = (version: PublicFormVersion): z.ZodType<FormAnswerEnvelope> =>
  rawFormAnswerEnvelopeSchema.pipe(
    z
      .object({ answers: z.record(z.string(), z.unknown()) })
      .strict()
      .superRefine(({ answers }, context) => {
        const answersWithDefaults = applyDefaultAnswers(version, answers)
        const stabilized = stabilizeReachableAnswers(version, answersWithDefaults)
        const { path } = stabilized
        const visibleQuestionIds = new Set(path.visibleQuestionIds)
        const questionsById = new Map(version.questions.map((question) => [question.id, question]))

        for (const question of version.questions) {
          if (!isFormQuestionInputCompatible(question)) {
            context.addIssue({
              code: 'custom',
              path: ['answers', question.id],
              message: 'QUESTION_INPUT_TYPE_MISMATCH',
            })
          }
        }

        for (const questionId of Object.keys(answers)) {
          if (!visibleQuestionIds.has(questionId)) {
            context.addIssue({
              code: 'custom',
              path: ['answers', questionId],
              message: 'UNREACHABLE_ANSWER',
            })
          }
        }

        for (const questionId of path.visibleQuestionIds) {
          const question = questionsById.get(questionId)
          if (question === undefined || !isFormQuestionInputCompatible(question)) continue
          const result = buildQuestionValueSchema(question).safeParse(
            stabilized.answers[questionId],
          )

          if (!result.success) {
            for (const issue of result.error.issues) {
              context.addIssue({
                code: 'custom',
                path: ['answers', questionId, ...issue.path],
                message: issue.message,
              })
            }
          }
        }
      }),
  )

export const projectReachableAnswers = (
  version: PublicFormVersion,
  answers: Record<string, unknown>,
): Record<string, unknown> => {
  return stabilizeReachableAnswers(version, applyDefaultAnswers(version, answers)).answers
}
