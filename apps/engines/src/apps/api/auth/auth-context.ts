export type AuthSource = 'api-key' | 'internal'

export type AuthContext = {
  userId: string
  source: AuthSource
  apiKeyId?: string
}

export type AuthedRequest = {
  headers: Record<string, string | string[] | undefined>
  auth?: AuthContext
}
