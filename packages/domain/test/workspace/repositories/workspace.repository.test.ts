import { describe, it, expect, vi } from 'vitest'

import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { WorkspaceRepository } from '../../../src/workspace/repositories/workspace.repository.ts'

function makeUow(row: unknown, blockRow: unknown = null) {
  const findUnique = vi.fn(async () => row)
  const blockFindUnique = vi.fn(async () => blockRow)
  const client = {
    workspaceMember: { findUnique },
    workspaceBlockedUser: { findUnique: blockFindUnique },
  }
  const uow: UnitOfWork = {
    client: () => client as never,
    transaction: async (fn) => fn(),
  }
  return { uow, findUnique, blockFindUnique }
}

describe('WorkspaceRepository.findMembership', () => {
  it('maps the Prisma row to a WorkspaceMembershipDto', async () => {
    const { uow, findUnique } = makeUow({
      workspaceId: 'w1',
      userId: 'u1',
      role: 'MEMBER',
      createdAt: new Date(),
    })
    const repo = new WorkspaceRepository(uow)
    const dto = await repo.findMembership('u1', 'w1')
    expect(dto).toEqual({ workspaceId: 'w1', userId: 'u1', role: 'MEMBER' })
    expect(findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
    })
  })

  it('returns null when there is no membership row', async () => {
    const { uow } = makeUow(null)
    const repo = new WorkspaceRepository(uow)
    expect(await repo.findMembership('u1', 'w1')).toBeNull()
  })
})

describe('WorkspaceRepository.findBlock', () => {
  it('queries workspace_blocked_users by the composite key', async () => {
    const { uow, blockFindUnique } = makeUow(null, { id: 'b1' })
    const repo = new WorkspaceRepository(uow)
    expect(await repo.findBlock('w1', 'u1')).toEqual({ id: 'b1' })
    expect(blockFindUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
      select: { id: true },
    })
  })

  it('returns null when the user is not blocked', async () => {
    const { uow } = makeUow(null, null)
    const repo = new WorkspaceRepository(uow)
    expect(await repo.findBlock('w1', 'u1')).toBeNull()
  })
})
