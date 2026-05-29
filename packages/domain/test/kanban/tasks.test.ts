import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { archiveTask, createTask, moveTask } from '../../src/kanban/tasks.ts'

function prismaWith(over: Record<string, unknown>) {
  const tx = {
    task: { create: vi.fn(async (a: { data: unknown }) => ({ id: 't1', ...(a.data as object) })), update: vi.fn(async () => ({ id: 't1' })) },
    taskActivity: { create: vi.fn(async () => ({})) },
    ...over,
  }
  return {
    page: { findFirst: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u1' })) },
    kanbanColumn: { findFirst: vi.fn(async () => ({ id: 'c1' })), findMany: vi.fn(async () => [{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }, { id: 'c2', title: 'Done', kind: 'DONE' }]) },
    kanbanType: { findFirst: vi.fn(async () => null) },
    kanbanPriority: { findFirst: vi.fn(async () => null) },
    sprint: { findFirst: vi.fn(async () => ({ id: 's1' })) },
    task: { findMany: vi.fn(async () => []), findUniqueOrThrow: vi.fn(async () => ({ id: 't1', pageId: 'b1', columnId: 'c1' })), update: tx.task.update },
    taskActivity: { create: tx.taskActivity.create },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    __tx: tx,
  } as unknown as PrismaClient & { __tx: typeof tx }
}

describe('domain kanban tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createTask records a CREATED activity and uses the first column when none given', async () => {
    const prisma = prismaWith({})
    const out = await createTask(prisma, 'u1', { pageId: 'b1', title: 'Ship' })
    expect(out.id).toBe('t1')
    expect((prisma as unknown as { __tx: { taskActivity: { create: ReturnType<typeof vi.fn> } } }).__tx.taskActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'CREATED' }) }),
    )
  })

  it('moveTask writes MOVED and STATUS_CHANGED when kind differs (Todo→Done)', async () => {
    const prisma = prismaWith({})
    await moveTask(prisma, 'u1', { pageId: 'b1', id: 't1', targetColumnId: 'c2', beforeId: null, afterId: null })
    const tx = (prisma as unknown as { __tx: { taskActivity: { create: ReturnType<typeof vi.fn> } } }).__tx
    const types = tx.taskActivity.create.mock.calls.map((c) => (c[0] as { data: { type: string } }).data.type)
    expect(types).toContain('MOVED')
    expect(types).toContain('STATUS_CHANGED')
  })

  it('archiveTask throws NOT_FOUND for a task on another page', async () => {
    const prisma = prismaWith({})
    ;(prisma.task.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', pageId: 'other' })
    await expect(archiveTask(prisma, 'u1', { pageId: 'b1', id: 't1' })).rejects.toBeInstanceOf(DomainError)
  })
})
