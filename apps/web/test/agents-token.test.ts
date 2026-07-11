import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '@repo/db'

import {
  getMembershipForToken,
  scopesForRole,
  signAgentsJwt,
  verifyAgentsCallback,
} from '../src/lib/agents-token'

// Scopes the engines MCP tools require (mirror of tool_registry.py DEFAULT_ENGINES_TOOLS).
// If a new tool adds a scope, grant it in agents-token.ts or this guard fails.
const REQUIRED_READ = [
  'pages:read',
  'search:query',
  'files:read',
  'workspaces:read',
  'notifications:read',
  'favorites:read',
  'reminders:read',
  'kanban:read',
] as const
const REQUIRED_WRITE = [
  'pages:write',
  'files:write',
  'reminders:write',
  'notifications:write',
  'favorites:write',
  'kanban:write',
] as const

describe('scopesForRole grants every scope the MCP tool registry requires', () => {
  it('OWNER gets all required read + write scopes', () => {
    const owner = scopesForRole('OWNER')
    for (const s of [...REQUIRED_READ, ...REQUIRED_WRITE]) expect(owner).toContain(s)
  })

  it('EDITOR gets all required read + write scopes', () => {
    const editor = scopesForRole('EDITOR')
    for (const s of [...REQUIRED_READ, ...REQUIRED_WRITE]) expect(editor).toContain(s)
  })

  it('VIEWER gets the required read scopes but not the writes', () => {
    const viewer = scopesForRole('VIEWER')
    for (const s of REQUIRED_READ) expect(viewer).toContain(s)
    for (const s of REQUIRED_WRITE) expect(viewer).not.toContain(s)
  })
})

describe('files:delete scope', () => {
  it('is granted to OWNER only', () => {
    expect(scopesForRole('OWNER')).toContain('files:delete')
    for (const role of ['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER', 'GUEST'] as const) {
      expect(scopesForRole(role)).not.toContain('files:delete')
    }
  })
})

describe('signAgentsJwt page binding (`pid` claim)', () => {
  // The claim name `pid` is a cross-service contract: apps/agents
  // jwt_verifier._context_from_claims maps it to AgentContext.page_id, and
  // tool_runner denies page-write tools targeting any other pageId.
  const SECRET = Buffer.alloc(32, 7).toString('base64')

  it('carries pid for a page-bound chat and omits it otherwise', async () => {
    vi.stubEnv('AGENTS_JWT_SECRET', SECRET)
    try {
      const base = {
        userId: 'u1',
        workspaceId: 'w1',
        chatId: 'c1',
        role: 'EDITOR' as const,
      }
      const bound = await signAgentsJwt({ ...base, boundPageId: 'p1' })
      const boundClaims = await verifyAgentsCallback(`Bearer ${bound}`)
      expect(boundClaims?.pid).toBe('p1')

      const unbound = await signAgentsJwt(base)
      const unboundClaims = await verifyAgentsCallback(`Bearer ${unbound}`)
      expect(unboundClaims).not.toBeNull()
      expect(unboundClaims?.pid).toBeUndefined()

      const nullBound = await signAgentsJwt({ ...base, boundPageId: null })
      const nullClaims = await verifyAgentsCallback(`Bearer ${nullBound}`)
      expect(nullClaims?.pid).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('getMembershipForToken refuses blocked users (no scopes minted)', () => {
  function prismaWith(member: { role: string } | null, blocked: { id: string } | null) {
    return {
      workspaceMember: { findUnique: vi.fn(async () => member) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => blocked) },
    } as unknown as PrismaClient
  }

  it('returns the member role for an active member', async () => {
    const membership = await getMembershipForToken(prismaWith({ role: 'EDITOR' }, null), 'w1', 'u1')
    expect(membership).toEqual({ role: 'EDITOR' })
  })

  it('returns null for a non-member', async () => {
    expect(await getMembershipForToken(prismaWith(null, null), 'w1', 'u1')).toBeNull()
  })

  it('returns null for a workspace-blocked member — the 403 path', async () => {
    const prisma = prismaWith({ role: 'EDITOR' }, { id: 'b1' })
    expect(await getMembershipForToken(prisma, 'w1', 'u1')).toBeNull()
    expect(prisma.workspaceBlockedUser.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
      select: { id: true },
    })
  })
})
