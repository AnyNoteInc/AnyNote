import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { activateSprint, completeSprint, createSprint } from '../../src/kanban/sprints.ts'

function ownerPrisma() {
  const tx = {
    sprint: { updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async () => ({ id: 's1' })), findUnique: vi.fn(async () => ({ id: 's1', pageId: 'b1' })) },
    task: { updateMany: vi.fn(async () => ({ count: 2 })) },
    kanbanColumn: { findMany: vi.fn(async () => [{ id: 'c1' }]) },
  }
  return {
    page: { findFirst: vi.fn(async () => ({ id: 'b1', workspaceId: 'w1', createdById: 'u1' })) },
    workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    sprint: { findMany: vi.fn(async () => []), create: vi.fn(async (a: { data: unknown }) => ({ id: 's1', ...(a.data as object) })) },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    __tx: tx,
  } as unknown as PrismaClient & { __tx: typeof tx }
}

describe('domain kanban sprints', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createSprint creates a PLANNED sprint (owner-gated)', async () => {
    const out = await createSprint(ownerPrisma(), 'u1', { pageId: 'b1', name: 'Sprint 1' })
    expect(out.id).toBe('s1')
    expect(out.status).toBe('PLANNED')
  })

  it('activateSprint demotes others then promotes target', async () => {
    const prisma = ownerPrisma()
    await activateSprint(prisma, 'u1', { pageId: 'b1', id: 's1' })
    const tx = (prisma as unknown as { __tx: { sprint: { updateMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } } }).__tx
    expect(tx.sprint.updateMany).toHaveBeenCalled()
    expect(tx.sprint.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ACTIVE' } }))
  })

  it('completeSprint rejects when moveUndoneTo === id', async () => {
    await expect(completeSprint(ownerPrisma(), 'u1', { pageId: 'b1', id: 's1', moveUndoneTo: 's1' })).rejects.toBeInstanceOf(DomainError)
  })
})
