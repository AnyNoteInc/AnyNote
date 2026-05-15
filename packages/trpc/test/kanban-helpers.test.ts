import { describe, expect, it, vi } from 'vitest'

import {
  endPosition,
  positionBetween,
  POSITION_GAP,
  seedKanbanDefaults,
  recordActivity,
} from '../src/routers/kanban/helpers'

describe('positionBetween', () => {
  it('returns midpoint of two finite values', () => {
    expect(positionBetween(10, 20)).toBe(15)
  })

  it('returns prev + GAP when only prev is given', () => {
    expect(positionBetween(10, null)).toBe(10 + POSITION_GAP)
  })

  it('returns next - GAP when only next is given', () => {
    expect(positionBetween(null, 20)).toBe(20 - POSITION_GAP)
  })

  it('returns 0 when neither is given (first item ever)', () => {
    expect(positionBetween(null, null)).toBe(0)
  })

  it('throws if gap underflows below precision floor', () => {
    expect(() => positionBetween(10, 10 + 1e-20)).toThrow(/precision/i)
  })
})

describe('endPosition', () => {
  it('returns 0 for empty array', () => {
    expect(endPosition([])).toBe(0)
  })

  it('returns max + GAP for non-empty', () => {
    expect(endPosition([{ position: 1 }, { position: 5 }, { position: 3 }])).toBe(5 + POSITION_GAP)
  })
})

describe('seedKanbanDefaults', () => {
  it('inserts 3 columns, 2 types, 5 priorities into the given tx', async () => {
    const columnCreateMany = vi.fn().mockResolvedValue({ count: 3 })
    const typeCreateMany = vi.fn().mockResolvedValue({ count: 2 })
    const priorityCreateMany = vi.fn().mockResolvedValue({ count: 5 })
    const tx = {
      kanbanColumn: { createMany: columnCreateMany },
      kanbanType: { createMany: typeCreateMany },
      kanbanPriority: { createMany: priorityCreateMany },
    } as never

    await seedKanbanDefaults(tx, 'page-1')

    expect(columnCreateMany).toHaveBeenCalledOnce()
    expect(columnCreateMany.mock.calls[0][0].data).toHaveLength(3)
    expect(columnCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      pageId: 'page-1',
      title: 'Todo',
      kind: 'ACTIVE',
    })
    expect(columnCreateMany.mock.calls[0][0].data[2]).toMatchObject({ title: 'Done', kind: 'DONE' })
    expect(typeCreateMany.mock.calls[0][0].data).toEqual([
      { pageId: 'page-1', title: 'Задача', position: 1024 },
      { pageId: 'page-1', title: 'Баг', position: 2048 },
    ])
    expect(priorityCreateMany.mock.calls[0][0].data).toHaveLength(5)
    expect(priorityCreateMany.mock.calls[0][0].data.map((p: { title: string }) => p.title)).toEqual(
      ['Критичный', 'Высокий', 'Средний', 'Низкий', 'Минимальный'],
    )
  })
})

describe('recordActivity', () => {
  it('inserts a task_activity row with the given fields', async () => {
    const create = vi.fn().mockResolvedValue({})
    const tx = { taskActivity: { create } } as never

    await recordActivity(tx, {
      taskId: 't-1',
      actorId: 'u-1',
      type: 'MOVED',
      payload: { fromColumnId: 'c-1', toColumnId: 'c-2' },
    })

    expect(create).toHaveBeenCalledWith({
      data: {
        taskId: 't-1',
        actorId: 'u-1',
        type: 'MOVED',
        payload: { fromColumnId: 'c-1', toColumnId: 'c-2' },
      },
    })
  })
})
