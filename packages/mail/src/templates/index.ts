import type { MailKind, MailPayloads, RenderedEmail } from '../types.js'
import { renderVerifyEmail } from './verify-email.js'
import { renderWelcome } from './welcome.js'
import { renderResetPassword } from './reset-password.js'
import { renderPasswordChanged } from './password-changed.js'
import { renderEmailChanged } from './email-changed.js'
import { renderNewLogin } from './new-login.js'
import { renderSuspiciousActivity } from './suspicious-activity.js'
import { renderInvitation } from './invitation.js'
import { renderAccountDeletionRequested } from './account-deletion-requested.js'
import { renderAccountDeletionCompleted } from './account-deletion-completed.js'

export function renderTemplate<K extends MailKind>(
  kind: K,
  data: MailPayloads[K],
): RenderedEmail {
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
    case 'account-deletion-requested':
      return renderAccountDeletionRequested(
        data as MailPayloads['account-deletion-requested'],
      )
    case 'account-deletion-completed':
      return renderAccountDeletionCompleted(
        data as MailPayloads['account-deletion-completed'],
      )
    default: {
      const _exhaustive: never = kind
      throw new Error(`renderTemplate: unsupported kind ${String(_exhaustive)}`)
    }
  }
}
