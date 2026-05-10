import type { MailKind, MailPayloads } from '@repo/mail'
import type { NotificationEventType } from '@repo/db'

// Stub — replaced by ./email.ts re-export in Task 7.
export function renderEmailForEvent(
  _type: NotificationEventType,
  _payload: Record<string, unknown>,
): { kind: MailKind; data: MailPayloads[MailKind] } | null {
  return null
}
