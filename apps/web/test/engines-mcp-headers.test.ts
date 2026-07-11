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
    expect(() => buildEnginesMcpHeaders({ userId: 'u', ts: 1 })).toThrow('AGENTS_TO_ENGINES_SECRET')
  })

  // Cross-service contract with apps/engines AgentsInternalAuthGuard: the HMAC
  // message is `userId:ts` for unbound chats and `userId:ts:boundPageId` when
  // `x-agents-bound-page` is sent — the guard recomputes exactly these strings,
  // so a drift here breaks every page-chat tool call.
  describe('page binding (x-agents-bound-page)', () => {
    const secret = Buffer.from('a'.repeat(32)).toString('base64')
    const hmac = (message: string): string =>
      crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(message).digest('base64')

    it('bound: signs userId:ts:pageId and sends the header', () => {
      vi.stubEnv('AGENTS_TO_ENGINES_SECRET', secret)
      const headers = buildEnginesMcpHeaders({ userId: 'u1', ts: 1234, boundPageId: 'p1' })
      expect(headers['authorization']).toBe(`Bearer ${hmac('u1:1234:p1')}`)
      expect(headers['x-agents-bound-page']).toBe('p1')
      // The binding is HMAC-covered — stripping the header invalidates the sig.
      expect(headers['authorization']).not.toBe(`Bearer ${hmac('u1:1234')}`)
    })

    it('null boundPageId behaves as unbound (legacy message, no header)', () => {
      vi.stubEnv('AGENTS_TO_ENGINES_SECRET', secret)
      const headers = buildEnginesMcpHeaders({ userId: 'u1', ts: 99, boundPageId: null })
      expect(headers['authorization']).toBe(`Bearer ${hmac('u1:99')}`)
      expect(headers).not.toHaveProperty('x-agents-bound-page')
    })
  })
})
