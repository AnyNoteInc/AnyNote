import type { MailKind, MailPayloads } from '@repo/mail'
import type { NotificationEventType } from '@repo/db'

export type EmailRendered = { kind: MailKind; data: MailPayloads[MailKind] }

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
    default:
      return null
  }
}
