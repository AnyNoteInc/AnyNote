import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { createHash } from 'node:crypto'

import type { PrismaClient } from '@repo/db'

import { ApiKeyGuard } from './api-key.guard.js'

function makeCtx(authorization?: string) {
  const req: any = { headers: { authorization } }
  return [{ switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext, req]
}

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

describe('ApiKeyGuard', () => {
  const prisma = {
    apiKey: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      update: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
  let guard: ApiKeyGuard

  beforeEach(() => {
    jest.clearAllMocks()
    guard = new ApiKeyGuard(prisma)
  })

  it('returns false when authorization missing (lets combinator try next strategy)', async () => {
    const [ctx] = makeCtx(undefined)
    await expect(guard.canActivate(ctx)).resolves.toBe(false)
  })

  it('returns false when authorization is not Bearer ank_', async () => {
    const [ctx] = makeCtx('Bearer xyz')
    await expect(guard.canActivate(ctx)).resolves.toBe(false)
  })

  it('throws Unauthorized when token format is right but key not found', async () => {
    ;(prisma as any).apiKey.findUnique.mockResolvedValue(null)
    const [ctx] = makeCtx('Bearer ank_abcdefghijklmnopqrstuvwx')
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('throws Unauthorized when key is revoked', async () => {
    ;(prisma as any).apiKey.findUnique.mockResolvedValue({
      id: 'k1', userId: 'u1', revokedAt: new Date(), expiresAt: null, lastUsedAt: null,
    })
    const [ctx] = makeCtx('Bearer ank_abcdefghijklmnopqrstuvwx')
    await expect(guard.canActivate(ctx)).rejects.toThrow(/revoked/i)
  })

  it('throws Unauthorized when key is expired', async () => {
    ;(prisma as any).apiKey.findUnique.mockResolvedValue({
      id: 'k1', userId: 'u1', revokedAt: null,
      expiresAt: new Date(Date.now() - 1000), lastUsedAt: null,
    })
    const [ctx] = makeCtx('Bearer ank_abcdefghijklmnopqrstuvwx')
    await expect(guard.canActivate(ctx)).rejects.toThrow(/expired/i)
  })

  it('attaches auth context and returns true for a valid key', async () => {
    const token = 'ank_abcdefghijklmnopqrstuvwx'
    ;(prisma as any).apiKey.findUnique.mockResolvedValue({
      id: 'k1', userId: 'u1', revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000), lastUsedAt: null,
    })
    const [ctx, req] = makeCtx(`Bearer ${token}`)
    await expect(guard.canActivate(ctx)).resolves.toBe(true)
    expect(req.auth).toEqual({ userId: 'u1', apiKeyId: 'k1', source: 'api-key' })
    expect((prisma as any).apiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: hashOf(token) },
    })
  })

  it('throttles lastUsedAt update to once per 60s', async () => {
    const recent = new Date(Date.now() - 30_000)
    ;(prisma as any).apiKey.findUnique.mockResolvedValue({
      id: 'k1', userId: 'u1', revokedAt: null, expiresAt: null, lastUsedAt: recent,
    })
    const [ctx] = makeCtx('Bearer ank_abcdefghijklmnopqrstuvwx')
    await guard.canActivate(ctx)
    await new Promise((r) => setImmediate(r))
    expect((prisma as any).apiKey.update).not.toHaveBeenCalled()
  })
})
