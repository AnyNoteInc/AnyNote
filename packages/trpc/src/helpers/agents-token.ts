import { SignJWT } from 'jose'

export type AgentsServiceAuth = { userId: string; workspaceId: string }

function getSecret(): Uint8Array {
  const raw = process.env.AGENTS_JWT_SECRET
  if (!raw) throw new Error('AGENTS_JWT_SECRET is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('AGENTS_JWT_SECRET must decode to 32 bytes')
  return key
}

function audience(): string {
  return process.env.BETTER_AUTH_JWT_AGENTS_AUDIENCE ?? 'agents'
}

// Short-lived token for internal tRPC→agents service calls (provider/MCP validation).
// No chat (cid) or scopes — agents verifies signature + audience only.
export async function signAgentsServiceToken(auth: AgentsServiceAuth): Promise<string> {
  return new SignJWT({ wsid: auth.workspaceId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setSubject(auth.userId)
    .setAudience(audience())
    .setExpirationTime('120s')
    .sign(getSecret())
}
