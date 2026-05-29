import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common'
import { isDomainError } from '@repo/domain'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'

/** Translate a @repo/domain DomainError into an MCP HttpException. */
export function mapDomainError(e: unknown): unknown {
  if (isDomainError(e)) return new HttpException({ code: `KANBAN_${e.code}`, message: e.message }, e.httpStatus)
  return e
}

@Injectable()
export class KanbanGateway {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  get db(): PrismaClient {
    return this.prisma
  }

  /** Run a domain call, mapping DomainError → HttpException. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw mapDomainError(e)
    }
  }

  async assertBoard(userId: string, workspaceId: string, boardPageId: string): Promise<{ id: string }> {
    const page = await this.prisma.page.findFirst({
      where: { id: boardPageId, type: 'KANBAN', workspaceId, workspace: { members: { some: { userId } } } },
      select: { id: true },
    })
    if (!page) throw new PageNotFoundError(boardPageId)
    return page
  }

  async resolveBoardPageId(userId: string, workspaceId: string, boardPageId?: string | null): Promise<string> {
    if (boardPageId) {
      await this.assertBoard(userId, workspaceId, boardPageId)
      return boardPageId
    }
    const boards = await this.prisma.page.findMany({
      where: {
        workspaceId,
        type: 'KANBAN',
        deletedAt: null,
        archived: false,
        workspace: { members: { some: { userId } } },
      },
      select: { id: true, title: true },
      take: 50,
    })
    if (boards.length === 0) throw new BadRequestException('No Kanban boards in this workspace')
    if (boards.length > 1) {
      const list = boards.map((b) => `"${b.title ?? ''}" (${b.id})`).join('; ')
      throw new BadRequestException(`Multiple Kanban boards — pass boardPageId. Boards: ${list}`)
    }
    return boards[0]!.id
  }

  async resolveColumnByStatus(boardPageId: string, status: string): Promise<string> {
    const columns = await this.prisma.kanbanColumn.findMany({
      where: { pageId: boardPageId },
      select: { id: true, title: true, kind: true },
    })
    const want = status.trim().toLowerCase()
    const hit = columns.find((c) => c.title.trim().toLowerCase() === want)
    if (!hit)
      throw new BadRequestException(
        `Unknown status "${status}". Available columns: ${columns.map((c) => `"${c.title}"`).join(', ') || '(none)'}`,
      )
    return hit.id
  }

  async findCancelColumn(boardPageId: string): Promise<string | null> {
    const columns = await this.prisma.kanbanColumn.findMany({
      where: { pageId: boardPageId },
      select: { id: true, kind: true },
    })
    return columns.find((c) => c.kind === 'CANCELLED')?.id ?? null
  }

  async resolveSprintTarget(boardPageId: string, target: string): Promise<string | null> {
    const t = target.trim()
    if (t.toLowerCase() === 'backlog') return null
    if (t.toLowerCase() === 'current') {
      const active = await this.prisma.sprint.findFirst({
        where: { pageId: boardPageId, status: 'ACTIVE' },
        select: { id: true },
      })
      if (!active) throw new BadRequestException('No active sprint on this board')
      return active.id
    }
    const sprints = await this.prisma.sprint.findMany({
      where: { pageId: boardPageId },
      select: { id: true, name: true, status: true, position: true },
      orderBy: { position: 'asc' },
    })
    if (t.toLowerCase() === 'next') {
      const active = sprints.find((s) => s.status === 'ACTIVE')
      const planned = sprints.filter((s) => s.status === 'PLANNED')
      const next = active ? planned.find((s) => s.position > active.position) ?? planned[0] : planned[0]
      if (!next) throw new BadRequestException('No next (planned) sprint on this board')
      return next.id
    }
    const byName = sprints.find((s) => s.name.trim().toLowerCase() === t.toLowerCase())
    if (byName) return byName.id
    const byId = sprints.find((s) => s.id === t)
    if (byId) return byId.id
    throw new BadRequestException(`Sprint not found: "${target}"`)
  }

  async resolveTypeByName(boardPageId: string, value: string): Promise<string> {
    const types = await this.prisma.kanbanType.findMany({
      where: { pageId: boardPageId },
      select: { id: true, title: true },
    })
    const v = value.trim().toLowerCase()
    const hit = types.find((t) => t.id === value || t.title.trim().toLowerCase() === v)
    if (!hit)
      throw new BadRequestException(
        `Unknown task type "${value}". Available: ${types.map((t) => `"${t.title}"`).join(', ')}`,
      )
    return hit.id
  }

  async resolvePriorityByName(boardPageId: string, value: string): Promise<string> {
    const priorities = await this.prisma.kanbanPriority.findMany({
      where: { pageId: boardPageId },
      select: { id: true, title: true },
    })
    const v = value.trim().toLowerCase()
    const hit = priorities.find((p) => p.id === value || p.title.trim().toLowerCase() === v)
    if (!hit)
      throw new BadRequestException(
        `Unknown priority "${value}". Available: ${priorities.map((p) => `"${p.title}"`).join(', ')}`,
      )
    return hit.id
  }

  resolveAssignee(callerUserId: string, value: string): string {
    return value === 'me' ? callerUserId : value
  }

  async currentAssigneeIds(taskId: string): Promise<string[]> {
    const rows = await this.prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })
    return rows.map((r) => r.userId)
  }
}
