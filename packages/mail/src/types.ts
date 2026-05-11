export type MailKind =
  | 'verify-email'
  | 'welcome'
  | 'reset-password'
  | 'password-changed'
  | 'email-changed'
  | 'new-login'
  | 'suspicious-activity'
  | 'invitation'
  | 'account-deletion-requested'
  | 'account-deletion-completed'
  | 'reminder-due'

export type RenderedEmail = { subject: string; html: string; text: string }

export type MailPayloads = {
  'verify-email': { firstName: string; link: string; expiresAtIso: string }
  welcome: { firstName: string; appUrl: string }
  'reset-password': { firstName: string; link: string; expiresAtIso: string }
  'password-changed': { firstName: string; supportEmail: string; ipAddress?: string }
  'email-changed': {
    firstName: string
    oldEmail: string
    newEmail: string
    isOldRecipient: boolean
  }
  'new-login': {
    firstName: string
    ipAddress: string
    userAgent: string
    location?: string
    loggedAtIso: string
  }
  'suspicious-activity': { firstName: string; reason: string; lockedUntilIso?: string }
  invitation: {
    firstName?: string
    inviterName: string
    workspaceName: string
    link: string
  }
  'account-deletion-requested': { firstName: string; link: string; expiresAtIso: string }
  'account-deletion-completed': { firstName: string }
  'reminder-due': {
    workspaceId: string
    pageId: string
    reminderId: string
    label: string | null
    dueAtIso: string
    offsetMinutes: number
    baseUrl: string
  }
}

export type MailEventPayload = {
  [K in MailKind]: { kind: K; to: string; data: MailPayloads[K] }
}[MailKind]
