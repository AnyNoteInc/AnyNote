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
  const apiKeyGuard = {
    canActivate: jest.fn<(c: ExecutionContext) => Promise<boolean>>(),
  } as unknown as ApiKeyGuard & CanActivate
  const internalGuard = {
    canActivate: jest.fn<(c: ExecutionContext) => Promise<boolean>>(),
  } as unknown as AgentsInternalAuthGuard & CanActivate
  let guard: McpAuthGuard

  beforeEach(() => {
    jest.clearAllMocks()
    guard = new McpAuthGuard(apiKeyGuard, internalGuard)
  })

  it('delegates to ApiKeyGuard when authorization is Bearer ank_', async () => {
    apiKeyGuard.canActivate.mockResolvedValue(true)
    await expect(guard.canActivate(makeCtx('Bearer ank_xxx'))).resolves.toBe(true)
    expect(apiKeyGuard.canActivate).toHaveBeenCalled()
    expect(internalGuard.canActivate).not.toHaveBeenCalled()
  })

  it('falls back to AgentsInternalAuthGuard otherwise', async () => {
    internalGuard.canActivate.mockResolvedValue(true)
    await expect(guard.canActivate(makeCtx('Bearer something-else'))).resolves.toBe(true)
    expect(internalGuard.canActivate).toHaveBeenCalled()
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled()
  })

  it('falls back to internal when authorization missing', async () => {
    internalGuard.canActivate.mockResolvedValue(true)
    await expect(guard.canActivate(makeCtx(undefined))).resolves.toBe(true)
    expect(internalGuard.canActivate).toHaveBeenCalled()
  })
})
