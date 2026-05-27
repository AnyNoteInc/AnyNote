import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common'

import { AgentsInternalAuthGuard } from '../../../auth/agents-internal-auth.guard.js'

import { ApiKeyGuard } from './api-key.guard.js'

@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeyGuard: ApiKeyGuard,
    private readonly internalGuard: AgentsInternalAuthGuard,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
    const raw = req.headers.authorization
    const auth = Array.isArray(raw) ? raw[0] : (raw as string | undefined)
    if (auth?.startsWith('Bearer ank_')) {
      return this.apiKeyGuard.canActivate(ctx)
    }
    return this.internalGuard.canActivate(ctx)
  }
}
