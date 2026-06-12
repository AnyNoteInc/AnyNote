export type MailKind =
  | 'verify-email'
  | 'welcome'
  | 'reset-password'
  | 'password-changed'
  | 'email-changed'
  | 'new-login'
  | 'suspicious-activity'
  | 'invitation'
  | 'guest-invitation'
  | 'account-deletion-requested'
  | 'account-deletion-completed'
  | 'reminder-due'
  | 'invoice-request'

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
  // Page-guest invite. Deliberately carries NO page title — metadata-only
  // discipline: pre-acceptance mail must not leak page content (people spec §6).
  'guest-invitation': {
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
  // Legal-entity invoice request (per-seat billing, Phase 8D). Sent to the
  // OPERATOR (BILLING_INVOICE_EMAIL), not the user — payment stays offline.
  'invoice-request': {
    legalName: string
    inn: string
    workspaceName: string
    ownerEmail: string
    seats: number
    periodMonths: number
    comment?: string
  }
}

export type MailEventPayload = {
  [K in MailKind]: { kind: K; to: string; data: MailPayloads[K] }
}[MailKind]
