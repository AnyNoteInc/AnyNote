import { z } from 'zod'

import { evaluateFormPath, type PublicFormQuestion, type PublicFormVersion } from './form-graph.ts'
import type { FormVersionDocument } from './form-document.ts'

export type FormAnswerEnvelope = {
  answers: Record<string, unknown>
}

const ANSWER_MAX_STRING_LENGTH = 2_048
const EMAIL_MAX_LENGTH = 320
const PHONE_MAX_LENGTH = 32
const LEASE_TOKEN_MAX_LENGTH = 4_096
const OPAQUE_ID_MAX_LENGTH = 512

export const toPublicFormVersion = (stored: FormVersionDocument): PublicFormVersion => {
  const { schemaVersion, firstSectionId, presentation, sections, questions, transitions, endings } =
    stored

  return {
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
  }
}

const isEmptyAnswer = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

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
  if (value.length > ANSWER_MAX_STRING_LENGTH || value.trim() !== value) return false

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
      if (input.step !== undefined) {
        const base = input.min ?? 0
        const quotient = (value - base) / input.step
        const tolerance = Number.EPSILON * 32 * Math.max(1, Math.abs(quotient))
        if (Math.abs(quotient - Math.round(quotient)) > tolerance) {
          addInvalidIssue(context, 'NUMBER_STEP_MISMATCH')
        }
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

export const buildQuestionValueSchema = (question: PublicFormQuestion): z.ZodType<unknown> =>
  z.unknown().superRefine((value, context) => {
    if (isEmptyAnswer(value)) {
      if (question.required) addInvalidIssue(context, 'REQUIRED_ANSWER')
      return
    }

    validateNonEmptyAnswer(question, value, context)
  })

export const buildFormAnswerSchema = (version: PublicFormVersion): z.ZodType<FormAnswerEnvelope> =>
  z
    .object({ answers: z.record(z.string(), z.unknown()) })
    .strict()
    .superRefine(({ answers }, context) => {
      const path = evaluateFormPath(version, answers)
      const visibleQuestionIds = new Set(path.visibleQuestionIds)
      const questionsById = new Map(version.questions.map((question) => [question.id, question]))

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
        if (question === undefined) continue
        const result = buildQuestionValueSchema(question).safeParse(answers[questionId])

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
    })

export const projectReachableAnswers = (
  version: PublicFormVersion,
  answers: Record<string, unknown>,
): Record<string, unknown> => {
  const reachableIds = new Set(evaluateFormPath(version, answers).visibleQuestionIds)
  return Object.fromEntries(
    Object.entries(answers).filter(([questionId]) => reachableIds.has(questionId)),
  )
}
