export type WebhookEventInput = {
  eventId: string
  event: string
  workspaceId: string
  actorId: string | null
  resourceType: 'page' | 'comment'
  resourceId: string
  hints?: Record<string, unknown>
  occurredAt: Date
}

const FORBIDDEN_KEYS = ['title', 'content', 'body', 'text', 'name'] as const
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const FORM_SUBMITTED_HINT_KEYS = [
  'formId',
  'versionNumber',
  'rowId',
  'itemPageId',
  'submittedAt',
  'respondentKind',
] as const

function assertExactFormSubmittedHints(hints: Record<string, unknown>): void {
  const keys = Object.keys(hints).sort()
  const expected = [...FORM_SUBMITTED_HINT_KEYS].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('database.form.submitted hints do not match the metadata-only contract')
  }
  if (
    typeof hints.formId !== 'string' ||
    !UUID_PATTERN.test(hints.formId) ||
    typeof hints.rowId !== 'string' ||
    !UUID_PATTERN.test(hints.rowId) ||
    typeof hints.itemPageId !== 'string' ||
    !UUID_PATTERN.test(hints.itemPageId) ||
    typeof hints.versionNumber !== 'number' ||
    !Number.isSafeInteger(hints.versionNumber) ||
    hints.versionNumber < 1 ||
    typeof hints.submittedAt !== 'string' ||
    Number.isNaN(Date.parse(hints.submittedAt)) ||
    (hints.respondentKind !== 'anonymous' && hints.respondentKind !== 'authenticated')
  ) {
    throw new Error('database.form.submitted hints contain invalid metadata')
  }
}

/**
 * Deep-walks the payload and throws if any key could carry user content.
 * Hints are caller-controlled — this assertion is the no-content regression net.
 */
export function assertNoForbiddenKeys(payload: unknown): void {
  if (payload === null || typeof payload !== 'object') return
  if (Array.isArray(payload)) {
    for (const item of payload) assertNoForbiddenKeys(item)
    return
  }
  for (const [key, value] of Object.entries(payload)) {
    if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Webhook payload must not contain key "${key}" (no-content contract)`)
    }
    assertNoForbiddenKeys(value)
  }
}

/** The documented v1 payload envelope — ids and hints only, never content. */
export function buildWebhookPayload(input: WebhookEventInput): Record<string, unknown> {
  const hints = input.hints ?? {}
  if (input.event === 'database.form.submitted') assertExactFormSubmittedHints(hints)
  const payload: Record<string, unknown> = {
    version: 1,
    id: input.eventId,
    event: input.event,
    timestamp: input.occurredAt.toISOString(),
    workspaceId: input.workspaceId,
    actor: { id: input.actorId },
    resource: { type: input.resourceType, id: input.resourceId },
    hints,
  }
  assertNoForbiddenKeys(payload)
  return payload
}
