import { Inject, CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { WorkspaceAccessDeniedError } from '../errors/mcp.errors.js'
import {
  normalizeMcpRequestBody,
  readMcpRequestContext,
  type McpRequestWithContext,
} from '../utils/mcp-request-context.js'

@Injectable()
export class McpTokenGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<McpRequestWithContext>()
    normalizeMcpRequestBody(req.body)
    req.mcpContext = readMcpRequestContext(req.headers)

    if ((req.body as { method?: unknown } | undefined)?.method === 'tools/list') {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: req.mcpContext.workspaceId,
            userId: req.mcpContext.userId,
          },
        },
        select: { userId: true },
      })

      if (!member) {
        throw new WorkspaceAccessDeniedError(req.mcpContext.workspaceId, req.mcpContext.userId)
      }
    }

    return true
  }
}
