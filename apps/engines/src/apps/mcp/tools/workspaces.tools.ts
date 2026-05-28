import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { mcpInput } from '../utils/mcp-input.js'

export const ListWorkspacesInput = z.object({
  workspaceId: mcpInput(z.string().uuid().optional()),
})
export type ListWorkspacesArgs = z.infer<typeof ListWorkspacesInput>

export type WorkspaceSummary = {
  id: string
  name: string
  slug: string | null
  role: string
  isCurrent: boolean
  isDefault: boolean
}

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
      'Список рабочих пространств пользователя с пометкой текущего (isCurrent) и ' +
      'дефолтного (isDefault). Возвращает id, name, slug, role, isCurrent, isDefault. ' +
      'Используй для "какие у меня пространства", "в каких пространствах я состою", ' +
      '"в каком пространстве я сейчас".',
    parameters: ListWorkspacesInput,
  })
  async listWorkspaces(args: ListWorkspacesArgs, _context: Context, req: AuthedRequest) {
    return this.doListWorkspaces(requireAuth(req), args)
  }

  async doListWorkspaces(
    auth: AuthContext,
    args: ListWorkspacesArgs,
  ): Promise<{ workspaces: WorkspaceSummary[] }> {
    const [rows, pref] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { userId: auth.userId },
        select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
        orderBy: { workspace: { name: 'asc' } },
        take: 200,
      }),
      this.prisma.userPreference.findFirst({
        where: { userId: auth.userId },
        select: { defaultWorkspaceId: true },
      }),
    ])
    return {
      workspaces: rows.map((r) => ({
        id: r.workspace.id,
        name: r.workspace.name,
        slug: r.workspace.slug,
        role: r.role,
        isCurrent: args.workspaceId != null && r.workspace.id === args.workspaceId,
        isDefault: pref?.defaultWorkspaceId === r.workspace.id,
      })),
    }
  }
}
