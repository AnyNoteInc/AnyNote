import { Inject, Injectable } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { PageNotFoundError } from "../errors/mcp.errors.js"

@Injectable()
export class StatsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async getWorkspaceStats(workspaceId: string) {
    const [members, grouped, totalPages] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.page.groupBy({
        by: ["type"],
        where: { workspaceId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.page.count({ where: { workspaceId, deletedAt: null } }),
    ])

    const pagesByType: Record<string, number> = {}
    for (const row of grouped as Array<{ type: string; _count: { _all: number } }>) {
      pagesByType[row.type] = row._count._all
    }

    return {
      members: members.map((m) => ({
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        role: m.role,
      })),
      pagesByType,
      totalPages,
    }
  }

  async getPageStats(pageId: string, workspaceId: string) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        ownership: true,
        createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    })
    if (!page || page.workspaceId !== workspaceId) throw new PageNotFoundError(pageId)
    return {
      type: page.type,
      ownership: page.ownership,
      createdAt: page.createdAt,
      createdBy: page.createdBy,
    }
  }
}
