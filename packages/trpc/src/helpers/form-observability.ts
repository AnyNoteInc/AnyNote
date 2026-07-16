import * as Sentry from '@sentry/nextjs'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SAFE_OUTCOMES = new Set([
  'accepted',
  'replayed',
  'rejected',
  'failed',
  'open',
  'unavailable',
  'cleaned',
])
const SAFE_REASONS = new Set([
  'captcha',
  'validation',
  'rate_limit',
  'stale_version',
  'honeypot',
  'policy',
  'not_found',
  'domain',
  'internal',
])

export type FormObservabilityEvent =
  | 'schema_load'
  | 'submit'
  | 'captcha_failure'
  | 'validation_failure'
  | 'transaction'
  | 'upload_cleanup'
  | 'notification_failure'

export type SafeFormLogContext = Partial<{
  formId: string
  versionId: string
  versionNumber: number
  outcome: string
  reason: string
  durationMs: number
  uploadCleanupCount: number
  acceptedResponseCount: number
}>

function safeNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  const number = safeNonNegativeNumber(value)
  return number !== undefined && Number.isInteger(number) ? number : undefined
}

/** Whitelists bounded operational metadata and drops every user-controlled value. */
export function safeFormLogContext(context: Record<string, unknown>): SafeFormLogContext {
  const safe: SafeFormLogContext = {}
  if (typeof context.formId === 'string' && UUID_PATTERN.test(context.formId)) {
    safe.formId = context.formId
  }
  if (typeof context.versionId === 'string' && UUID_PATTERN.test(context.versionId)) {
    safe.versionId = context.versionId
  }
  const versionNumber = safeNonNegativeInteger(context.versionNumber)
  if (versionNumber !== undefined) safe.versionNumber = versionNumber
  if (typeof context.outcome === 'string' && SAFE_OUTCOMES.has(context.outcome)) {
    safe.outcome = context.outcome
  }
  if (typeof context.reason === 'string' && SAFE_REASONS.has(context.reason)) {
    safe.reason = context.reason
  }
  const durationMs = safeNonNegativeNumber(context.durationMs)
  if (durationMs !== undefined) safe.durationMs = durationMs
  const uploadCleanupCount = safeNonNegativeInteger(context.uploadCleanupCount)
  if (uploadCleanupCount !== undefined) safe.uploadCleanupCount = uploadCleanupCount
  const acceptedResponseCount = safeNonNegativeInteger(context.acceptedResponseCount)
  if (acceptedResponseCount !== undefined) safe.acceptedResponseCount = acceptedResponseCount
  return safe
}

export function observeFormEvent(
  event: FormObservabilityEvent,
  context: Record<string, unknown>,
): void {
  try {
    const data = safeFormLogContext(context)
    // A structured server log is an actual emitted event (unlike a breadcrumb,
    // which only survives when a later Sentry event is sent). Production log
    // aggregation can derive counters and latency distributions from it.
    console.info('[database.forms]', { event, ...data })
    Sentry.addBreadcrumb({
      category: 'database.forms',
      message: event,
      level: event.endsWith('failure') ? 'warning' : 'info',
      data,
    })
  } catch {
    // Observability is deliberately non-authoritative for public form traffic.
  }
}

export function captureFormOperationalFailure(
  event: Extract<FormObservabilityEvent, 'notification_failure'>,
  context: Record<string, unknown>,
): void {
  try {
    Sentry.captureMessage(`database.forms.${event}`, {
      level: 'error',
      extra: safeFormLogContext(context),
    })
  } catch {
    // A committed response must remain accepted when telemetry is unavailable.
  }
}
