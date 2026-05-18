import { beforeAll, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { decodeJwt } from 'jose'

import {
  scopesForRole,
  signAgentsJwt,
  verifyAgentsCallback,
} from '@/lib/agents-token'

beforeAll(() => {
  process.env.AGENTS_JWT_SECRET = crypto.randomBytes(32).toString('base64')
  process.env.BETTER_AUTH_JWT_AGENTS_AUDIENCE = 'agents'
})

describe('scopesForRole', () => {
  it('OWNER gets every scope including delete', () => {
    const scopes = scopesForRole('OWNER')
    expect(scopes).toContain('pages:delete')
    expect(scopes).toContain('memory:write')
  })

  it('EDITOR gets writes but not pages:delete', () => {
    const scopes = scopesForRole('EDITOR')
    expect(scopes).not.toContain('pages:delete')
    expect(scopes).toContain('pages:write')
  })

  it('VIEWER gets only read scopes', () => {
    const scopes = scopesForRole('VIEWER')
    expect(scopes).not.toContain('pages:write')
    expect(scopes).not.toContain('memory:write')
    expect(scopes).toContain('pages:read')
    expect(scopes).toContain('search:query')
  })
})

describe('signAgentsJwt', () => {
  it('encodes claims with 300s ttl and agents audience', async () => {
    const token = await signAgentsJwt({
      userId: 'u1',
      workspaceId: 'w1',
      chatId: 'c1',
      role: 'OWNER',
    })
    const claims = decodeJwt(token)
    expect(claims.aud).toBe('agents')
    expect(claims.sub).toBe('u1')
    expect(claims.wsid).toBe('w1')
    expect(claims.cid).toBe('c1')
    expect(claims.exp! - claims.iat!).toBeLessThanOrEqual(300)
  })
})

describe('verifyAgentsCallback', () => {
  it('round-trips a freshly-signed token', async () => {
    const token = await signAgentsJwt({
      userId: 'u1',
      workspaceId: 'w1',
      chatId: 'c1',
      role: 'OWNER',
    })
    const claims = await verifyAgentsCallback(`Bearer ${token}`)
    expect(claims?.sub).toBe('u1')
    expect(claims?.scopes).toContain('pages:delete')
  })

  it('returns null on missing/bad scheme', async () => {
    expect(await verifyAgentsCallback('')).toBeNull()
    expect(await verifyAgentsCallback('Basic abc')).toBeNull()
  })

  it('returns null on tampered signature', async () => {
    const token = await signAgentsJwt({
      userId: 'u1',
      workspaceId: 'w1',
      chatId: 'c1',
      role: 'OWNER',
    })
    const tampered = token.slice(0, -4) + 'XXXX'
    expect(await verifyAgentsCallback(`Bearer ${tampered}`)).toBeNull()
  })

  it('returns null on wrong audience', async () => {
    const originalAud = process.env.BETTER_AUTH_JWT_AGENTS_AUDIENCE
    process.env.BETTER_AUTH_JWT_AGENTS_AUDIENCE = 'wrong'
    const token = await signAgentsJwt({
      userId: 'u1',
      workspaceId: 'w1',
      chatId: 'c1',
      role: 'OWNER',
    })
    process.env.BETTER_AUTH_JWT_AGENTS_AUDIENCE = originalAud
    expect(await verifyAgentsCallback(`Bearer ${token}`)).toBeNull()
  })
})
