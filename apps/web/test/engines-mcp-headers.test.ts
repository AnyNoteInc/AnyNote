import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildEnginesMcpHeaders } from '../src/lib/chat/engines-mcp-headers'

describe('buildEnginesMcpHeaders', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('sets Authorization Bearer with correct HMAC', () => {
    const secret = Buffer.from('a'.repeat(32)).toString('base64')
    vi.stubEnv('AGENTS_TO_ENGINES_SECRET', secret)

    const userId = 'u1'
    const ts = 1700000000

    const headers = buildEnginesMcpHeaders({ userId, ts })

    const expected = crypto
      .createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(`${userId}:${ts}`)
      .digest('base64')

    expect(headers['authorization']).toBe(`Bearer ${expected}`)
    expect(headers['x-agents-user']).toBe(userId)
    expect(headers).not.toHaveProperty('x-agents-workspace')
    expect(headers['x-agents-timestamp']).toBe(String(ts))
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Accept']).toBe('application/json, text/event-stream')
  })

  it('throws when AGENTS_TO_ENGINES_SECRET is missing', () => {
    vi.stubEnv('AGENTS_TO_ENGINES_SECRET', '')
    expect(() => buildEnginesMcpHeaders({ userId: 'u', ts: 1 })).toThrow(
      'AGENTS_TO_ENGINES_SECRET',
    )
  })
})
