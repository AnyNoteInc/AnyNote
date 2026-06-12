import type { MailKind, MailPayloads, RenderedEmail } from '../types.ts'
import { renderVerifyEmail } from './verify-email.ts'
import { renderWelcome } from './welcome.ts'
import { renderResetPassword } from './reset-password.ts'
import { renderPasswordChanged } from './password-changed.ts'
import { renderEmailChanged } from './email-changed.ts'
import { renderNewLogin } from './new-login.ts'
import { renderSuspiciousActivity } from './suspicious-activity.ts'
import { renderInvitation } from './invitation.ts'
import { renderGuestInvitation } from './guest-invitation.ts'
import { renderAccountDeletionRequested } from './account-deletion-requested.ts'
import { renderAccountDeletionCompleted } from './account-deletion-completed.ts'
import { renderReminderDue } from './reminder-due.ts'
import { renderInvoiceRequest } from './invoice-request.ts'

export function renderTemplate<K extends MailKind>(kind: K, data: MailPayloads[K]): RenderedEmail {
  switch (kind) {
    case 'verify-email':
      return renderVerifyEmail(data as MailPayloads['verify-email'])
    case 'welcome':
      return renderWelcome(data as MailPayloads['welcome'])
    case 'reset-password':
      return renderResetPassword(data as MailPayloads['reset-password'])
    case 'password-changed':
      return renderPasswordChanged(data as MailPayloads['password-changed'])
    case 'email-changed':
      return renderEmailChanged(data as MailPayloads['email-changed'])
    case 'new-login':
      return renderNewLogin(data as MailPayloads['new-login'])
    case 'suspicious-activity':
      return renderSuspiciousActivity(data as MailPayloads['suspicious-activity'])
    case 'invitation':
      return renderInvitation(data as MailPayloads['invitation'])
    case 'guest-invitation':
      return renderGuestInvitation(data as MailPayloads['guest-invitation'])
    case 'account-deletion-requested':
      return renderAccountDeletionRequested(data as MailPayloads['account-deletion-requested'])
    case 'account-deletion-completed':
      return renderAccountDeletionCompleted(data as MailPayloads['account-deletion-completed'])
    case 'reminder-due':
      return renderReminderDue(data as MailPayloads['reminder-due'])
    case 'invoice-request':
      return renderInvoiceRequest(data as MailPayloads['invoice-request'])
    default: {
      const _exhaustive: never = kind
      throw new Error(`renderTemplate: unsupported kind ${String(_exhaustive)}`)
    }
  }
}
