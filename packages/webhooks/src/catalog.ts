export const WEBHOOK_EVENT_TYPES = [
  'page.created',
  'page.content_updated',
  'page.properties_updated',
  'page.moved',
  'page.deleted',
  'page.undeleted',
  'comment.created',
  'comment.resolved',
  'database.form.submitted',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export function isWebhookEventType(v: string): v is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(v)
}

/** Documented-but-not-yet-emitted (the 7C portal lists them as «скоро»). */
export const COMING_EVENT_TYPES = [
  'collection.created',
  'collection.updated',
  'database.row_changed',
] as const
