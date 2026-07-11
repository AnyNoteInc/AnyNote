import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from '@jest/globals'
import type { ExecutionContext } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AgentsInternalAuthGuard } from './agents-internal-auth.guard.js'

function makeCtx(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext
}

function sign(secret: string, userId: string, ts: number, boundPageId?: string) {
  const message = boundPageId ? `${userId}:${ts}:${boundPageId}` : `${userId}:${ts}`
  return crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(message).digest('base64')
}

const SECRET = crypto.randomBytes(32).toString('base64')

describe('AgentsInternalAuthGuard', () => {
  beforeEach(() => {
    process.env.AGENTS_TO_ENGINES_SECRET = SECRET
  })

  it('accepts a valid HMAC within the timestamp window and sets req.auth', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    const request: Record<string, unknown> = {
      headers: {
        authorization: `Bearer ${sign(SECRET, 'u', ts)}`,
        'x-agents-user': 'u',
        'x-agents-timestamp': String(ts),
      },
    }
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext
    expect(guard.canActivate(ctx)).toBe(true)
    expect(request.auth).toEqual({ userId: 'u', source: 'internal' })
  })

  it('accepts a bound-page header covered by the HMAC and exposes boundPageId', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    const request: Record<string, unknown> = {
      headers: {
        authorization: `Bearer ${sign(SECRET, 'u', ts, 'p1')}`,
        'x-agents-user': 'u',
        'x-agents-timestamp': String(ts),
        'x-agents-bound-page': 'p1',
      },
    }
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext
    expect(guard.canActivate(ctx)).toBe(true)
    expect(request.auth).toEqual({ userId: 'u', source: 'internal', boundPageId: 'p1' })
  })

  it('rejects a bound-page header the HMAC does not cover', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    // HMAC signed over the legacy `userId:ts` message only — a binding header
    // spliced onto such a request must not authenticate.
    const ctx = makeCtx({
      authorization: `Bearer ${sign(SECRET, 'u', ts)}`,
      'x-agents-user': 'u',
      'x-agents-timestamp': String(ts),
      'x-agents-bound-page': 'p1',
    })
    expect(() => guard.canActivate(ctx)).toThrow(/invalid HMAC/i)
  })

  it('rejects a tampered bound-page header', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    const ctx = makeCtx({
      authorization: `Bearer ${sign(SECRET, 'u', ts, 'p1')}`,
      'x-agents-user': 'u',
      'x-agents-timestamp': String(ts),
      'x-agents-bound-page': 'p2',
    })
    expect(() => guard.canActivate(ctx)).toThrow(/invalid HMAC/i)
  })

  it('rejects an expired timestamp', async () => {
    const ts = Math.floor(Date.now() / 1000) - 700
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    const ctx = makeCtx({
      authorization: `Bearer ${sign(SECRET, 'u', ts)}`,
      'x-agents-user': 'u',
      'x-agents-timestamp': String(ts),
    })
    expect(() => guard.canActivate(ctx)).toThrow(/timestamp/i)
  })

  it('rejects a tampered HMAC', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    const ctx = makeCtx({
      authorization: 'Bearer dGFtcGVyZWQ=',
      'x-agents-user': 'u',
      'x-agents-timestamp': String(ts),
    })
    expect(() => guard.canActivate(ctx)).toThrow()
  })

  it('rejects missing headers', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    const ctx = makeCtx({})
    expect(() => guard.canActivate(ctx)).toThrow(/missing/i)
  })
})
