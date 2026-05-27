import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'

export const ListWorkspacesInput = z.object({})
export type ListWorkspacesArgs = z.infer<typeof ListWorkspacesInput>

export type WorkspaceSummary = { id: string; name: string; slug: string | null; role: string }

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class WorkspacesTools {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Tool({
    name: 'list_workspaces',
    description:
      'Список рабочих пространств текущего пользователя. Возвращает id, name, slug, role. ' +
      'Используй перед вызовами других тулов, чтобы выбрать workspaceId.',
    parameters: ListWorkspacesInput,
  })
  async listWorkspaces(
    _args: ListWorkspacesArgs,
    _context: Context,
    req: AuthedRequest,
  ): Promise<{ workspaces: WorkspaceSummary[] }> {
    return this.doListWorkspaces(requireAuth(req))
  }

  async doListWorkspaces(auth: AuthContext): Promise<{ workspaces: WorkspaceSummary[] }> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId: auth.userId },
      select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
      orderBy: { workspace: { name: 'asc' } },
      take: 200,
    })
    return {
      workspaces: rows.map((r) => ({
        id: r.workspace.id,
        name: r.workspace.name,
        slug: r.workspace.slug,
        role: r.role,
      })),
    }
  }
}
