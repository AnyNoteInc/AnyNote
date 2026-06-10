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
  const payload: Record<string, unknown> = {
    version: 1,
    id: input.eventId,
    event: input.event,
    timestamp: input.occurredAt.toISOString(),
    workspaceId: input.workspaceId,
    actor: { id: input.actorId },
    resource: { type: input.resourceType, id: input.resourceId },
    hints: input.hints ?? {},
  }
  assertNoForbiddenKeys(payload)
  return payload
}
