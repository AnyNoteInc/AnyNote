import type { NotificationEventType } from '@repo/db'

import { renderInApp } from './in-app.ts'

export type PushRendered = { title: string; body: string; url: string | null }

export function renderPushPayload(
  type: NotificationEventType,
  payload: Record<string, unknown>,
  resourceUrl: string | null,
): PushRendered | null {
  const inApp = renderInApp(type, payload)
  return { title: inApp.title, body: inApp.body, url: resourceUrl }
}
