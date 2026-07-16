import { TRPCError, type TRPC_ERROR_CODE_KEY } from '@trpc/server'
import { isDomainError } from '@repo/domain/errors.ts'

export type PublicFormFieldErrors = Readonly<Record<string, readonly string[]>>

const MAX_FIELD_ERRORS = 500
const MAX_MESSAGES_PER_FIELD = 20
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const SAFE_FORM_FIELD_MESSAGES = new Set([
  'CONSENT_REQUIRED',
  'DANGEROUS_OBJECT_KEY',
  'DUPLICATE_OPTION_ANSWER',
  'FORM_TARGET_INACCESSIBLE',
  'FORM_UPLOAD_INVALID',
  'INVALID_CHECKBOX',
  'INVALID_DATE',
  'INVALID_EMAIL',
  'INVALID_FILE_TOKENS',
  'INVALID_NUMBER',
  'INVALID_OBJECT_PROTOTYPE',
  'INVALID_OPTION_ID',
  'INVALID_OPTION_IDS',
  'INVALID_PHONE',
  'INVALID_TARGET_ID',
  'INVALID_TARGET_IDS',
  'INVALID_TEXT',
  'INVALID_URL',
  'NUMBER_STEP_MISMATCH',
  'NUMBER_TOO_LARGE',
  'NUMBER_TOO_SMALL',
  'QUESTION_INPUT_TYPE_MISMATCH',
  'REQUIRED_ANSWER',
  'TEXT_TOO_LONG',
  'TEXT_TOO_SHORT',
  'TOO_FEW_SELECTIONS',
  'TOO_MANY_SELECTIONS',
  'UNREACHABLE_ANSWER',
])

const HTTP_TO_TRPC: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
}

export async function mapDomain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (isDomainError(e)) {
      throw new TRPCError({
        code: HTTP_TO_TRPC[e.httpStatus] ?? 'BAD_REQUEST',
        message: e.message,
        cause: e,
      })
    }
    throw e
  }
}

/** Extract only bounded, code-only question errors approved for public form clients. */
export function publicFormFieldErrors(error: unknown): PublicFormFieldErrors | undefined {
  const cause = error instanceof TRPCError ? error.cause : error
  if (!isDomainError(cause) || cause.message !== 'FORM_ANSWERS_INVALID') return undefined

  const details = cause.details
  if (details === null || typeof details !== 'object') return undefined
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors
  // FormValidationError exposes the exact same safe map both directly and in
  // DomainError.details. Requiring that identity avoids accepting arbitrary
  // DomainError details without importing the heavy form service at runtime.
  if ((cause as typeof cause & { fieldErrors?: unknown }).fieldErrors !== fieldErrors) {
    return undefined
  }
  if (fieldErrors === null || typeof fieldErrors !== 'object' || Array.isArray(fieldErrors)) {
    return undefined
  }
  const prototype = Object.getPrototypeOf(fieldErrors)
  if (prototype !== Object.prototype && prototype !== null) return undefined

  const entries = Object.entries(fieldErrors)
  if (entries.length === 0 || entries.length > MAX_FIELD_ERRORS) return undefined
  for (const [questionId, messages] of entries) {
    if (
      questionId.length === 0 ||
      questionId.length > 64 ||
      DANGEROUS_KEYS.has(questionId) ||
      !Array.isArray(messages) ||
      messages.length === 0 ||
      messages.length > MAX_MESSAGES_PER_FIELD ||
      !messages.every(
        (message) => typeof message === 'string' && SAFE_FORM_FIELD_MESSAGES.has(message),
      )
    ) {
      return undefined
    }
  }

  return Object.fromEntries(entries) as PublicFormFieldErrors
}
