import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import type { PrismaClient } from '@repo/db'

/**
 * Short-lived JWT used to authenticate apps/web → apps/agents calls (and the
 * agents → web callbacks for action-log and memory writes). Signed with a
 * shared HMAC secret because both services live in the same trust domain.
 *
 * Spec note: the original design called for an RSA-signed token validated via
 * better-auth's JWKS endpoint. We use HMAC HS256 with a shared secret instead
 * — it matches the agents→engines HMAC pattern and avoids a second JWT plugin
 * instance in better-auth. Public-key rotation is therefore not needed.
 */

export type AgentsScope =
  | 'pages:read'
  | 'pages:write'
  | 'pages:delete'
  | 'files:read'
  | 'files:write'
  | 'files:delete'
  | 'kanban:read'
  | 'kanban:write'
  | 'workspaces:read'
  | 'reminders:read'
  | 'reminders:write'
  | 'notifications:read'
  | 'notifications:write'
  | 'favorites:read'
  | 'favorites:write'
  | 'memory:read'
  | 'memory:write'
  | 'search:query'

export type AgentsRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' | 'GUEST'

const READ_SCOPES: AgentsScope[] = [
  'pages:read',
  'files:read',
  'kanban:read',
  'workspaces:read',
  'reminders:read',
  'notifications:read',
  'favorites:read',
  'memory:read',
  'search:query',
]

const WRITE_SCOPES: AgentsScope[] = [
  'pages:write',
  'files:write',
  'kanban:write',
  'reminders:write',
  'notifications:write',
  'favorites:write',
  'memory:write',
]

export function scopesForRole(role: AgentsRole): AgentsScope[] {
  switch (role) {
    case 'OWNER':
      return [...READ_SCOPES, ...WRITE_SCOPES, 'pages:delete', 'files:delete']
    case 'ADMIN':
    case 'EDITOR':
      return [...READ_SCOPES, ...WRITE_SCOPES]
    case 'COMMENTER':
    case 'VIEWER':
    case 'GUEST':
      return [...READ_SCOPES]
  }
}

/**
 * The single membership lookup that feeds `scopesForRole`: active members only.
 * A `workspace_blocked_users` row (inline one-liner mirror of @repo/domain
 * `PeopleService.isWorkspaceBlocked`) yields null — callers map that to their
 * 403 path, so no agents JWT is ever minted for a blocked user.
 */
export async function getMembershipForToken(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string,
): Promise<{ role: AgentsRole } | null> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!member) return null
  const blocked = await prisma.workspaceBlockedUser.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  })
  if (blocked) return null
  return { role: member.role as AgentsRole }
}

export type AgentsJwtClaims = JWTPayload & {
  sub: string
  aud: string
  wsid: string
  cid: string
  scopes: AgentsScope[]
}

const TTL_SECONDS = 300

function getSecret(): Uint8Array {
  const raw = process.env.AGENTS_JWT_SECRET
  if (!raw) throw new Error('AGENTS_JWT_SECRET is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('AGENTS_JWT_SECRET must decode to 32 bytes')
  }
  return key
}

function audience(): string {
  return process.env.BETTER_AUTH_JWT_AGENTS_AUDIENCE ?? 'agents'
}

export async function signAgentsJwt(args: {
  userId: string
  workspaceId: string
  chatId: string
  role: AgentsRole
}): Promise<string> {
  const scopes = scopesForRole(args.role)
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    wsid: args.workspaceId,
    cid: args.chatId,
    scopes,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setSubject(args.userId)
    .setAudience(audience())
    .setExpirationTime(now + TTL_SECONDS)
    .sign(getSecret())
}

export async function verifyAgentsCallback(authorization: string): Promise<AgentsJwtClaims | null> {
  const [scheme, token] = authorization.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      audience: audience(),
      algorithms: ['HS256'],
    })
    return payload as AgentsJwtClaims
  } catch {
    return null
  }
}
