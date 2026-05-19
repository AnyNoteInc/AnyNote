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

function sign(secret: string, userId: string, workspaceId: string, ts: number) {
  return crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${userId}:${workspaceId}:${ts}`)
    .digest('base64')
}

const SECRET = crypto.randomBytes(32).toString('base64')

describe('AgentsInternalAuthGuard', () => {
  beforeEach(() => {
    process.env.AGENTS_TO_ENGINES_SECRET = SECRET
  })

  it('accepts a valid HMAC within the timestamp window', async () => {
    const ts = Math.floor(Date.now() / 1000)
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    const ctx = makeCtx({
      authorization: `Bearer ${sign(SECRET, 'u', 'w', ts)}`,
      'x-agents-user': 'u',
      'x-agents-workspace': 'w',
      'x-agents-timestamp': String(ts),
    })
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('rejects an expired timestamp', async () => {
    const ts = Math.floor(Date.now() / 1000) - 700
    const moduleRef = await Test.createTestingModule({
      providers: [AgentsInternalAuthGuard],
    }).compile()
    const guard = moduleRef.get(AgentsInternalAuthGuard)
    const ctx = makeCtx({
      authorization: `Bearer ${sign(SECRET, 'u', 'w', ts)}`,
      'x-agents-user': 'u',
      'x-agents-workspace': 'w',
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
      'x-agents-workspace': 'w',
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
