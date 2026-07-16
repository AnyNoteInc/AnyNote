import type { MailKind, MailPayloads } from '@repo/mail'
import type { NotificationEventType } from '@repo/db'

export type EmailRendered = { kind: MailKind; data: MailPayloads[MailKind] }

/**
 * Authoritative public origin for links baked into transactional emails.
 * Prefers `BETTER_AUTH_URL` (a server-side runtime var) over the build-time
 * `NEXT_PUBLIC_BASE_URL`; an empty/whitespace value is treated as unset so it
 * doesn't win and produce a path-only link. Trailing slashes are trimmed.
 */
function resolveEmailBaseUrl(): string {
  const pick = (v: string | undefined): string | undefined => v?.trim() || undefined
  const raw = pick(process.env.BETTER_AUTH_URL) ?? pick(process.env.NEXT_PUBLIC_BASE_URL) ?? ''
  return raw.replace(/\/+$/, '')
}

export function renderEmailForEvent(
  type: NotificationEventType,
  payload: Record<string, unknown>,
): EmailRendered | null {
  const p = payload as Record<string, string | undefined>
  switch (type) {
    case 'VERIFY_EMAIL':
      return {
        kind: 'verify-email',
        data: {
          firstName: p.firstName ?? '',
          link: p.link ?? '',
          expiresAtIso: p.expiresAtIso ?? '',
        },
      }
    case 'RESET_PASSWORD':
      return {
        kind: 'reset-password',
        data: {
          firstName: p.firstName ?? '',
          link: p.link ?? '',
          expiresAtIso: p.expiresAtIso ?? '',
        },
      }
    case 'PASSWORD_CHANGED':
      return {
        kind: 'password-changed',
        data: {
          firstName: p.firstName ?? '',
          supportEmail: p.supportEmail ?? 'support@anynote.dev',
          ipAddress: p.ipAddress,
        },
      }
    case 'EMAIL_CHANGED':
      return {
        kind: 'email-changed',
        data: {
          firstName: p.firstName ?? '',
          oldEmail: p.oldEmail ?? '',
          newEmail: p.newEmail ?? '',
          isOldRecipient: payload.isOldRecipient === true,
        },
      }
    case 'WELCOME':
      return {
        kind: 'welcome',
        data: { firstName: p.firstName ?? '', appUrl: p.appUrl ?? '' },
      }
    case 'ACCOUNT_DELETION_REQUESTED':
      return {
        kind: 'account-deletion-requested',
        data: {
          firstName: p.firstName ?? '',
          link: p.link ?? '',
          expiresAtIso: p.expiresAtIso ?? '',
        },
      }
    case 'ACCOUNT_DELETION_COMPLETED':
      return {
        kind: 'account-deletion-completed',
        data: { firstName: p.firstName ?? '' },
      }
    case 'NEW_LOGIN':
      return {
        kind: 'new-login',
        data: {
          firstName: p.firstName ?? '',
          ipAddress: p.ipAddress ?? '',
          userAgent: p.userAgent ?? '',
          location: p.location,
          loggedAtIso: p.loggedAtIso ?? new Date().toISOString(),
        },
      }
    case 'SUSPICIOUS_ACTIVITY':
      return {
        kind: 'suspicious-activity',
        data: {
          firstName: p.firstName ?? '',
          reason: p.reason ?? '',
          lockedUntilIso: p.lockedUntilIso,
        },
      }
    case 'WORKSPACE_INVITE':
      return {
        kind: 'invitation',
        data: {
          firstName: p.firstName,
          inviterName: p.inviterName ?? '',
          workspaceName: p.workspaceName ?? '',
          link: p.link ?? '',
        },
      }
    case 'REMINDER_DUE': {
      const reminderId = typeof p.reminderId === 'string' ? p.reminderId : ''
      const pageId = typeof p.pageId === 'string' ? p.pageId : ''
      const workspaceId = typeof p.workspaceId === 'string' ? p.workspaceId : ''
      const offset = typeof payload.offsetMinutes === 'number' ? payload.offsetMinutes : 0
      return {
        kind: 'reminder-due',
        data: {
          workspaceId,
          pageId,
          reminderId,
          label: typeof p.label === 'string' ? p.label : null,
          dueAtIso: p.dueAt ?? '',
          offsetMinutes: offset,
          // Prefer BETTER_AUTH_URL (server-side runtime origin) over the
          // build-time NEXT_PUBLIC_BASE_URL so email links use the configured
          // domain, not localhost behind the reverse proxy. Empty/whitespace
          // is treated as unset so it doesn't win and yield a path-only link.
          baseUrl: resolveEmailBaseUrl(),
        },
      }
    }
    case 'FORM_SUBMITTED':
      return {
        kind: 'form-submitted',
        data: {
          formLabel: p.formLabel ?? 'Без названия',
          submittedAtIso: p.submittedAt ?? '',
          resourceUrl: p.resourceUrl ?? '/',
          baseUrl: resolveEmailBaseUrl(),
        },
      }
    default:
      return null
  }
}
