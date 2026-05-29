import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Prisma } from '@repo/db'

import { seedKanbanDefaults } from '../../src/kanban/seed.ts'

describe('seedKanbanDefaults', () => {
  const columnCreateMany = vi.fn(async () => ({ count: 3 }))
  const typeCreateMany = vi.fn(async () => ({ count: 2 }))
  const priorityCreateMany = vi.fn(async () => ({ count: 4 }))
  const tx = {
    kanbanColumn: { createMany: columnCreateMany },
    kanbanType: { createMany: typeCreateMany },
    kanbanPriority: { createMany: priorityCreateMany },
  } as unknown as Prisma.TransactionClient

  beforeEach(() => vi.clearAllMocks())

  it('seeds 3 columns, 2 types, 4 priorities for the page', async () => {
    await seedKanbanDefaults(tx, 'page-1')
    expect(columnCreateMany).toHaveBeenCalledWith({
      data: [
        { pageId: 'page-1', title: 'Todo', kind: 'ACTIVE', position: 1024 },
        { pageId: 'page-1', title: 'In Progress', kind: 'ACTIVE', position: 2048 },
        { pageId: 'page-1', title: 'Done', kind: 'DONE', position: 3072 },
      ],
    })
    expect(typeCreateMany).toHaveBeenCalledWith({
      data: [
        { pageId: 'page-1', title: 'Задача', position: 1024 },
        { pageId: 'page-1', title: 'Баг', position: 2048 },
      ],
    })
    expect(priorityCreateMany).toHaveBeenCalledWith({
      data: [
        { pageId: 'page-1', title: 'Низкий', color: '#6B7280', position: 1024 },
        { pageId: 'page-1', title: 'Средний', color: '#3B82F6', position: 2048 },
        { pageId: 'page-1', title: 'Высокий', color: '#F97316', position: 3072 },
        { pageId: 'page-1', title: 'Критичный', color: '#EF4444', position: 4096 },
      ],
    })
  })
})
