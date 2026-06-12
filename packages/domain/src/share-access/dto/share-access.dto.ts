export type PublicAccessRole = 'READER' | 'COMMENTER' | 'EDITOR'

export type PublicUnavailableReason =
  | 'not_found'
  | 'disabled'
  | 'unpublished'
  | 'expired'
  | 'not_yet_exposed'
  | 'password_required'
  | 'restricted_child'
  /** Workspace security policy `disablePublicLinksSitesForms` (8C §4) — honest, not a 404. */
  | 'policy_disabled'

export type ResolvedPublicPage = {
  id: string
  type: string
  title: string | null
  icon: string | null
  workspaceId: string
}

export type ResolvedShareMeta = {
  shareId: string
  mode: 'LINK' | 'SITE'
  allowCopy: boolean
  allowIndexing: boolean
  publishSubpages: boolean
  analyticsGoogleId: string | null
  analyticsYandexMetricaId: string | null
}

export type PublicShareResult =
  | { status: 'ok'; role: PublicAccessRole; page: ResolvedPublicPage; share: ResolvedShareMeta }
  | { status: 'unavailable'; reason: PublicUnavailableReason }

export type ResolvePublicShareInput = {
  shareId: string
  requestedPageId?: string
  password?: string
  now: Date
}
