import { describe, it, expect, beforeEach, vi } from 'vitest'

import { DomainError } from '../../src/shared/errors.ts'
import { KanbanService } from '../../src/kanban/services/kanban.service.ts'
import type { KanbanRepository } from '../../src/kanban/repositories/kanban.repository.ts'
import type { UnitOfWork } from '../../src/shared/unit-of-work.ts'

// ── Fake UoW — transaction(fn) = fn(), client() unused by service ─────────────
function makeUow(): UnitOfWork {
  return {
    transaction: (fn) => fn(),
    client: vi.fn() as unknown as UnitOfWork['client'],
  }
}

// ── Repo factory — override individual methods per test ───────────────────────
function makeRepo(overrides: Partial<KanbanRepository> = {}): KanbanRepository {
  return {
    findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u1' })),
    findMembershipRole: vi.fn(async () => 'OWNER'),
    recordActivity: vi.fn(async () => undefined),
    findColumn: vi.fn(async () => ({ id: 'c1' })),
    findSprint: vi.fn(async () => ({ id: 's1' })),
    findTypeAndPriority: vi.fn(async () => [null, null]),
    findTasksInColumn: vi.fn(async () => []),
    findTasksInSprint: vi.fn(async () => []),
    createTask: vi.fn(async (d) => ({ id: 't1', pageId: d.pageId, columnId: d.columnId, position: d.position })),
    findTaskForUpdate: vi.fn(async () => ({
      id: 't1',
      pageId: 'b1',
      title: 'Old',
      dueDate: null,
      startDate: null,
      typeId: null,
      priorityId: null,
      sprintId: null,
      parentId: null,
    })),
    updateTask: vi.fn(async () => ({ id: 't1', pageId: 'b1' })),
    findTaskForMove: vi.fn(async () => ({ id: 't1', pageId: 'b1', columnId: 'c1' })),
    findColumnsForPage: vi.fn(async () => [
      { id: 'c1', title: 'Todo', kind: 'ACTIVE' },
      { id: 'c2', title: 'Done', kind: 'DONE' },
    ]),
    findTasksInTargetColumn: vi.fn(async () => []),
    moveTask: vi.fn(async () => ({ id: 't1', pageId: 'b1' })),
    findTaskForAssignees: vi.fn(async () => ({ id: 't1', pageId: 'b1', assignees: [] })),
    deleteAssignees: vi.fn(async () => undefined),
    createAssignees: vi.fn(async () => undefined),
    createActivityMany: vi.fn(async () => undefined),
    findTaskPageId: vi.fn(async () => ({ pageId: 'b1' })),
    archiveTask: vi.fn(async () => undefined),
    createTaskComment: vi.fn(async () => ({ id: 'cm1', taskId: 't1', authorId: 'u1' })),
    findSprintsForPosition: vi.fn(async () => []),
    createSprint: vi.fn(async (d) => ({ id: 's1', pageId: d.pageId, name: d.name, status: d.status, position: d.position })),
    demoteActiveSprints: vi.fn(async () => undefined),
    activateSprint: vi.fn(async () => undefined),
    findSprintById: vi.fn(async () => ({ id: 's1', pageId: 'b1' })),
    findSprintAndDestAndColumns: vi.fn(async () => ({
      sprint: { id: 's1', pageId: 'b1' },
      dest: null,
      undoneColumns: [{ id: 'c1' }],
    })),
    moveUndoneTasksToSprint: vi.fn(async () => undefined),
    completeSprint: vi.fn(async () => undefined),
    seedKanbanDefaults: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as KanbanRepository
}

function makeService(repo: KanbanRepository, uow = makeUow()) {
  return new KanbanService(repo, uow)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('KanbanService.createTask', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a task and records CREATED activity', async () => {
    const repo = makeRepo()
    const svc = makeService(repo)
    const result = await svc.createTask('u1', { pageId: 'b1', title: 'Ship it' })
    expect(result.id).toBe('t1')
    expect(repo.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CREATED' }),
    )
  })

  it('throws NOT_FOUND when the user has no page access', async () => {
    const repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    await expect(makeService(repo).createTask('u1', { pageId: 'b1', title: 'x' })).rejects.toBeInstanceOf(DomainError)
  })

  it('throws BAD_REQUEST when the board has no columns', async () => {
    const repo = makeRepo({ findColumn: vi.fn(async () => null) })
    await expect(makeService(repo).createTask('u1', { pageId: 'b1', title: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('uses endPosition to place the new task at the end', async () => {
    const repo = makeRepo({
      findTasksInColumn: vi.fn(async () => [{ position: 2048 }]),
    })
    const svc = makeService(repo)
    await svc.createTask('u1', { pageId: 'b1', title: 'Last' })
    expect(repo.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ position: 3072 }), // 2048 + 1024 gap
    )
  })
})

describe('KanbanService.updateTask', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records RENAMED only when the title actually changes', async () => {
    const repo = makeRepo()
    await makeService(repo).updateTask('u1', { pageId: 'b1', id: 't1', title: 'New' })
    const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    )
    expect(types).toContain('RENAMED')
  })

  it('does NOT record RENAMED when the title is unchanged', async () => {
    const repo = makeRepo()
    await makeService(repo).updateTask('u1', { pageId: 'b1', id: 't1', title: 'Old' })
    const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    )
    expect(types).not.toContain('RENAMED')
  })

  it('records SPRINT_CHANGED with fromId/toId when sprint changes', async () => {
    const repo = makeRepo()
    await makeService(repo).updateTask('u1', { pageId: 'b1', id: 't1', sprintId: 's9' })
    expect(repo.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SPRINT_CHANGED', payload: { fromId: null, toId: 's9' } }),
    )
  })

  it('records DUE_DATE_CHANGED with ISO strings when date changes', async () => {
    const repo = makeRepo({
      findTaskForUpdate: vi.fn(async () => ({
        id: 't1', pageId: 'b1', title: 'x', dueDate: new Date('2025-01-01'),
        startDate: null, typeId: null, priorityId: null, sprintId: null, parentId: null,
      })),
    })
    const newDate = new Date('2025-06-01')
    await makeService(repo).updateTask('u1', { pageId: 'b1', id: 't1', dueDate: newDate })
    expect(repo.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DUE_DATE_CHANGED',
        payload: { from: '2025-01-01T00:00:00.000Z', to: '2025-06-01T00:00:00.000Z' },
      }),
    )
  })

  it('does NOT record DUE_DATE_CHANGED when the date is the same', async () => {
    const d = new Date('2025-01-01')
    const repo = makeRepo({
      findTaskForUpdate: vi.fn(async () => ({
        id: 't1', pageId: 'b1', title: 'x', dueDate: d,
        startDate: null, typeId: null, priorityId: null, sprintId: null, parentId: null,
      })),
    })
    await makeService(repo).updateTask('u1', { pageId: 'b1', id: 't1', dueDate: new Date(d.getTime()) })
    const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    )
    expect(types).not.toContain('DUE_DATE_CHANGED')
  })

  it('records DESCRIPTION_CHANGED whenever description is provided', async () => {
    const repo = makeRepo()
    await makeService(repo).updateTask('u1', { pageId: 'b1', id: 't1', description: { ops: [] } })
    expect(repo.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DESCRIPTION_CHANGED' }),
    )
  })

  it('throws NOT_FOUND when task belongs to another page', async () => {
    const repo = makeRepo({
      findTaskForUpdate: vi.fn(async () => ({
        id: 't1', pageId: 'other', title: 'x',
        dueDate: null, startDate: null, typeId: null, priorityId: null, sprintId: null, parentId: null,
      })),
    })
    await expect(
      makeService(repo).updateTask('u1', { pageId: 'b1', id: 't1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('KanbanService.moveTask', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records MOVED and STATUS_CHANGED when column kind differs (ACTIVE→DONE)', async () => {
    const repo = makeRepo()
    await makeService(repo).moveTask('u1', {
      pageId: 'b1', id: 't1', targetColumnId: 'c2', beforeId: null, afterId: null,
    })
    const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    )
    expect(types).toContain('MOVED')
    expect(types).toContain('STATUS_CHANGED')
  })

  it('records MOVED but NOT STATUS_CHANGED when column kind is the same', async () => {
    const repo = makeRepo({
      findColumnsForPage: vi.fn(async () => [
        { id: 'c1', title: 'Todo', kind: 'ACTIVE' },
        { id: 'c3', title: 'In Progress', kind: 'ACTIVE' },
      ]),
    })
    await makeService(repo).moveTask('u1', {
      pageId: 'b1', id: 't1', targetColumnId: 'c3', beforeId: null, afterId: null,
    })
    const types = (repo.recordActivity as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    )
    expect(types).toContain('MOVED')
    expect(types).not.toContain('STATUS_CHANGED')
  })

  it('throws BAD_REQUEST when target column is not found', async () => {
    const repo = makeRepo({
      findColumnsForPage: vi.fn(async () => [{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }]),
    })
    await expect(
      makeService(repo).moveTask('u1', {
        pageId: 'b1', id: 't1', targetColumnId: 'nonexistent', beforeId: null, afterId: null,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('KanbanService.setTaskAssignees', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds new assignee and records ASSIGNED', async () => {
    const repo = makeRepo({
      findTaskForAssignees: vi.fn(async () => ({
        id: 't1', pageId: 'b1', assignees: [{ userId: 'u2' }],
      })),
    })
    await makeService(repo).setTaskAssignees('u1', { pageId: 'b1', id: 't1', userIds: ['u2', 'u3'] })
    expect(repo.createAssignees).toHaveBeenCalledWith('t1', ['u3'])
    const rows = (repo.createActivityMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { type: string }[]
    expect(rows.some((r) => r.type === 'ASSIGNED')).toBe(true)
  })

  it('removes old assignee and records UNASSIGNED', async () => {
    const repo = makeRepo({
      findTaskForAssignees: vi.fn(async () => ({
        id: 't1', pageId: 'b1', assignees: [{ userId: 'u2' }, { userId: 'u3' }],
      })),
    })
    await makeService(repo).setTaskAssignees('u1', { pageId: 'b1', id: 't1', userIds: ['u2'] })
    expect(repo.deleteAssignees).toHaveBeenCalledWith('t1', ['u3'])
    const rows = (repo.createActivityMany as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { type: string }[]
    expect(rows.some((r) => r.type === 'UNASSIGNED')).toBe(true)
  })

  it('returns { ok: true }', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).setTaskAssignees('u1', { pageId: 'b1', id: 't1', userIds: [] })
    expect(result).toEqual({ ok: true })
  })
})

describe('KanbanService.archiveTask', () => {
  beforeEach(() => vi.clearAllMocks())

  it('archives the task and records ARCHIVED', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).archiveTask('u1', { pageId: 'b1', id: 't1' })
    expect(repo.archiveTask).toHaveBeenCalledWith('t1', 'u1')
    expect(repo.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ARCHIVED' }),
    )
    expect(result).toEqual({ ok: true })
  })

  it('throws NOT_FOUND when task belongs to another page', async () => {
    const repo = makeRepo({ findTaskPageId: vi.fn(async () => ({ pageId: 'other' })) })
    await expect(
      makeService(repo).archiveTask('u1', { pageId: 'b1', id: 't1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('KanbanService.createSprint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a PLANNED sprint at the end position (ownership-gated)', async () => {
    const repo = makeRepo({
      findSprintsForPosition: vi.fn(async () => [{ position: 2048 }]),
    })
    const result = await makeService(repo).createSprint('u1', { pageId: 'b1', name: 'Sprint 1' })
    expect(result.status).toBe('PLANNED')
    expect(result.position).toBe(3072) // 2048 + 1024
  })

  it('throws NOT_FOUND for a non-member', async () => {
    const repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    await expect(
      makeService(repo).createSprint('u1', { pageId: 'b1', name: 'Sprint 1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws FORBIDDEN for a non-owner member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u9' })),
      findMembershipRole: vi.fn(async () => 'MEMBER'),
    })
    await expect(
      makeService(repo).createSprint('u1', { pageId: 'b1', name: 'Sprint 1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('KanbanService.activateSprint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('demotes other active sprints then promotes the target', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).activateSprint('u1', { pageId: 'b1', id: 's1' })
    expect(repo.demoteActiveSprints).toHaveBeenCalledWith('b1', 's1')
    expect(repo.activateSprint).toHaveBeenCalledWith('s1', 'b1')
    expect(result).toEqual({ ok: true })
  })

  it('maps P2002 to CONFLICT error', async () => {
    const repo = makeRepo({
      activateSprint: vi.fn(async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }) }),
    })
    await expect(
      makeService(repo).activateSprint('u1', { pageId: 'b1', id: 's1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rethrows non-P2002 errors as-is', async () => {
    const boom = new Error('db exploded')
    const repo = makeRepo({ activateSprint: vi.fn(async () => { throw boom }) })
    await expect(
      makeService(repo).activateSprint('u1', { pageId: 'b1', id: 's1' }),
    ).rejects.toBe(boom)
  })
})

describe('KanbanService.completeSprint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects when moveUndoneTo === id', async () => {
    const repo = makeRepo()
    await expect(
      makeService(repo).completeSprint('u1', { pageId: 'b1', id: 's1', moveUndoneTo: 's1' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('moves undone tasks and marks sprint COMPLETED', async () => {
    const repo = makeRepo({
      findSprintAndDestAndColumns: vi.fn(async () => ({
        sprint: { id: 's1', pageId: 'b1' },
        dest: { id: 's2', pageId: 'b1' },
        undoneColumns: [{ id: 'c1' }],
      })),
    })
    const result = await makeService(repo).completeSprint('u1', {
      pageId: 'b1', id: 's1', moveUndoneTo: 's2',
    })
    expect(repo.moveUndoneTasksToSprint).toHaveBeenCalledWith('s1', ['c1'], 's2')
    expect(repo.completeSprint).toHaveBeenCalledWith('s1')
    expect(result).toEqual({ ok: true })
  })

  it('throws NOT_FOUND when sprint does not belong to the page', async () => {
    const repo = makeRepo({
      findSprintAndDestAndColumns: vi.fn(async () => ({
        sprint: { id: 's1', pageId: 'other' },
        dest: null,
        undoneColumns: [],
      })),
    })
    await expect(
      makeService(repo).completeSprint('u1', { pageId: 'b1', id: 's1', moveUndoneTo: null }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws NOT_FOUND when destination sprint is on another page', async () => {
    const repo = makeRepo({
      findSprintAndDestAndColumns: vi.fn(async () => ({
        sprint: { id: 's1', pageId: 'b1' },
        dest: { id: 's2', pageId: 'other' },
        undoneColumns: [{ id: 'c1' }],
      })),
    })
    await expect(
      makeService(repo).completeSprint('u1', { pageId: 'b1', id: 's1', moveUndoneTo: 's2' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('KanbanService.createTaskComment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the comment and records COMMENTED', async () => {
    const repo = makeRepo()
    const result = await makeService(repo).createTaskComment('u1', {
      pageId: 'b1', taskId: 't1', content: { ops: [] },
    })
    expect(result.id).toBe('cm1')
    expect(repo.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'COMMENTED', payload: { commentId: 'cm1' } }),
    )
  })

  it('throws NOT_FOUND when the task belongs to a different page', async () => {
    const repo = makeRepo({ findTaskPageId: vi.fn(async () => ({ pageId: 'other' })) })
    await expect(
      makeService(repo).createTaskComment('u1', { pageId: 'b1', taskId: 't1', content: {} }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws NOT_FOUND when the user has no page access', async () => {
    const repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    await expect(
      makeService(repo).createTaskComment('u1', { pageId: 'b1', taskId: 't1', content: {} }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('kanban role enforcement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createTask is FORBIDDEN for a COMMENTER member who is not the creator', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'COMMENTER'),
    })
    await expect(
      makeService(repo).createTask('u1', { pageId: 'b1', columnId: 'c1', title: 'X' } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createTask is FORBIDDEN for a VIEWER member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
    })
    await expect(
      makeService(repo).createTask('u1', { pageId: 'b1', columnId: 'c1', title: 'X' } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createTask succeeds for an EDITOR member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'),
    })
    const result = await makeService(repo).createTask('u1', {
      pageId: 'b1', columnId: 'c1', title: 'X',
    } as never)
    expect(result.id).toBe('t1')
  })

  it('createTaskComment succeeds for a COMMENTER member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'COMMENTER'),
      findTaskPageId: vi.fn(async () => ({ pageId: 'b1' })),
    })
    const result = await makeService(repo).createTaskComment('u1', {
      pageId: 'b1', taskId: 't1', content: { text: 'hi' },
    } as never)
    expect(result.id).toBe('cm1')
  })

  it('createTaskComment is FORBIDDEN for a VIEWER member', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'someone-else' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
      findTaskPageId: vi.fn(async () => ({ pageId: 'b1' })),
    })
    await expect(
      makeService(repo).createTaskComment('u1', {
        pageId: 'b1', taskId: 't1', content: { text: 'hi' },
      } as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createTask succeeds for the board creator regardless of role', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u1' })),
      findMembershipRole: vi.fn(async () => 'VIEWER'),
    })
    const result = await makeService(repo).createTask('u1', {
      pageId: 'b1', columnId: 'c1', title: 'X',
    } as never)
    expect(result.id).toBe('t1')
  })
})

describe('KanbanService.seedDefaults', () => {
  it('delegates to repo.seedKanbanDefaults', async () => {
    const repo = makeRepo()
    await makeService(repo).seedDefaults('page-1')
    expect(repo.seedKanbanDefaults).toHaveBeenCalledWith('page-1')
  })
})

describe('access: assertAccess / assertOwnership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('assertAccess throws NOT_FOUND for non-members (via createTask)', async () => {
    const repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    await expect(
      makeService(repo).createTask('u1', { pageId: 'b1', title: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  })

  it('assertOwnership allows the page creator (via createSprint)', async () => {
    // createdById === actorUserId → no membership check needed
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u1' })),
      findMembershipRole: vi.fn(async () => { throw new Error('should not be called') }),
    })
    await expect(
      makeService(repo).createSprint('u1', { pageId: 'b1', name: 'S1' }),
    ).resolves.toBeDefined()
    expect(repo.findMembershipRole).not.toHaveBeenCalled()
  })

  it('assertOwnership allows workspace OWNER who is not the creator (via createSprint)', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u9' })),
      findMembershipRole: vi.fn(async () => 'OWNER'),
    })
    await expect(
      makeService(repo).createSprint('u1', { pageId: 'b1', name: 'S1' }),
    ).resolves.toBeDefined()
  })

  it('assertOwnership throws FORBIDDEN for a non-owner non-creator (via createSprint)', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u9' })),
      findMembershipRole: vi.fn(async () => 'EDITOR'),
    })
    await expect(
      makeService(repo).createSprint('u1', { pageId: 'b1', name: 'S1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  })
})
