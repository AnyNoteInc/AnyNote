import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { prisma } from '@repo/db'

import { KanbanGateway } from '../../src/apps/mcp/services/kanban-gateway.service.js'
import type { MarkdownParser } from '../../src/apps/mcp/services/markdown-parser.service.js'
import { KanbanWriteService } from '../../src/apps/mcp/services/kanban-write.service.js'

/**
 * Proves the engines write path runs end-to-end against a real Postgres:
 *   KanbanWriteService → KanbanGateway → @repo/domain → Prisma → DB.
 * This is the only layer that exercises @repo/domain against a live database —
 * the tRPC and engines unit suites both mock Prisma. Requires `docker compose up -d`.
 */
describe('Kanban engines → @repo/domain → DB (integration)', () => {
  // addTaskComment is the only write that touches the parser; these tests don't call it.
  const parserStub = { parse: () => ({ type: 'doc', content: [] }) } as unknown as MarkdownParser
  const gateway = new KanbanGateway(prisma)
  const writes = new KanbanWriteService(gateway, parserStub)

  let workspaceId: string
  let userId: string
  let pageId: string
  let todoColumnId: string
  let doneColumnId: string

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: 'kanban-domain-int' } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: {
        name: 'Kanban User',
        firstName: 'K',
        lastName: 'U',
        email: `kanban-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: 'OWNER' } })
    const page = await prisma.page.create({
      data: { workspaceId, title: 'Board', type: 'KANBAN', createdById: userId, updatedById: userId },
    })
    pageId = page.id
    // Two columns of differing kind so a cross-column move also records STATUS_CHANGED.
    const todo = await prisma.kanbanColumn.create({
      data: { pageId, title: 'К выполнению', kind: 'ACTIVE', position: 1024 },
    })
    todoColumnId = todo.id
    const done = await prisma.kanbanColumn.create({
      data: { pageId, title: 'Готово', kind: 'DONE', position: 2048 },
    })
    doneColumnId = done.id
  })

  afterEach(async () => {
    // Page→Workspace, Column/Task→Page, Activity→Task all cascade; delete workspace then user.
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('createTask lands in the first column with a CREATED activity', async () => {
    const { taskId } = await writes.createTask(userId, workspaceId, {
      boardPageId: pageId,
      title: 'Integration task',
    })

    const created = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(created.columnId).toBe(todoColumnId)
    expect(created.pageId).toBe(pageId)
    expect(created.createdById).toBe(userId)

    const types = (
      await prisma.taskActivity.findMany({ where: { taskId }, select: { type: true } })
    ).map((a) => a.type)
    expect(types).toContain('CREATED')
  })

  it('moveTaskToStatus moves the task and records MOVED + STATUS_CHANGED', async () => {
    const { taskId } = await writes.createTask(userId, workspaceId, {
      boardPageId: pageId,
      title: 'Task to move',
    })

    const moved = await writes.moveTaskToStatus(userId, workspaceId, {
      boardPageId: pageId,
      taskId,
      status: 'Готово',
    })
    expect(moved).toEqual({ ok: true })

    const after = await prisma.task.findUniqueOrThrow({ where: { id: taskId } })
    expect(after.columnId).toBe(doneColumnId)

    const types = (
      await prisma.taskActivity.findMany({ where: { taskId }, select: { type: true } })
    ).map((a) => a.type)
    expect(types).toContain('CREATED')
    expect(types).toContain('MOVED')
    expect(types).toContain('STATUS_CHANGED')
  })
})
