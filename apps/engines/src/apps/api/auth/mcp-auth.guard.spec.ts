import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { type CanActivate, ExecutionContext } from '@nestjs/common'

import type { ApiKeyGuard } from './api-key.guard.js'
import type { AgentsInternalAuthGuard } from '../../../auth/agents-internal-auth.guard.js'
import { McpAuthGuard } from './mcp-auth.guard.js'

function makeCtx(authorization?: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext
}

describe('McpAuthGuard', () => {
  const apiKeyCanActivate = jest.fn<(c: ExecutionContext) => Promise<boolean>>()
  const internalCanActivate = jest.fn<(c: ExecutionContext) => Promise<boolean>>()
  const apiKeyGuard = { canActivate: apiKeyCanActivate } as unknown as ApiKeyGuard & CanActivate
  const internalGuard = {
    canActivate: internalCanActivate,
  } as unknown as AgentsInternalAuthGuard & CanActivate
  let guard: McpAuthGuard

  beforeEach(() => {
    jest.clearAllMocks()
    guard = new McpAuthGuard(apiKeyGuard, internalGuard)
  })

  it('delegates to ApiKeyGuard when authorization is Bearer ank_', async () => {
    apiKeyCanActivate.mockResolvedValue(true)
    await expect(guard.canActivate(makeCtx('Bearer ank_xxx'))).resolves.toBe(true)
    expect(apiKeyCanActivate).toHaveBeenCalled()
    expect(internalCanActivate).not.toHaveBeenCalled()
  })

  it('falls back to AgentsInternalAuthGuard otherwise', async () => {
    internalCanActivate.mockResolvedValue(true)
    await expect(guard.canActivate(makeCtx('Bearer something-else'))).resolves.toBe(true)
    expect(internalCanActivate).toHaveBeenCalled()
    expect(apiKeyCanActivate).not.toHaveBeenCalled()
  })

  it('falls back to internal when authorization missing', async () => {
    internalCanActivate.mockResolvedValue(true)
    await expect(guard.canActivate(makeCtx(undefined))).resolves.toBe(true)
    expect(internalCanActivate).toHaveBeenCalled()
  })
})
