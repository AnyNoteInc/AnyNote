export type AuthSource = 'api-key' | 'internal'

export type AuthContext = {
  userId: string
  source: AuthSource
  apiKeyId?: string
  /**
   * Page id the calling chat is bound to (page chats). Set by
   * AgentsInternalAuthGuard from the HMAC-covered `x-agents-bound-page`
   * header; write tools must refuse to touch any other page.
   */
  boundPageId?: string
}

export type AuthedRequest = {
  headers: Record<string, string | string[] | undefined>
  auth?: AuthContext
}
