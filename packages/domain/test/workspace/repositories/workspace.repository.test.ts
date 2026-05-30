import { describe, it, expect, vi } from 'vitest'

import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { WorkspaceRepository } from '../../../src/workspace/repositories/workspace.repository.ts'

function makeUow(row: unknown) {
  const findUnique = vi.fn(async () => row)
  const client = { workspaceMember: { findUnique } }
  const uow: UnitOfWork = {
    client: () => client as never,
    transaction: async (fn) => fn(),
  }
  return { uow, findUnique }
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
