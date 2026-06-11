import { describe, it, expect, vi } from 'vitest'

import { isDomainError } from '../../../src/shared/errors.ts'
import type { WorkspaceRepository } from '../../../src/workspace/repositories/workspace.repository.ts'
import { WorkspaceService } from '../../../src/workspace/services/workspace.service.ts'

function makeRepo(membership: unknown, block: { id: string } | null = null) {
  return {
    findMembership: vi.fn(async () => membership),
    findBlock: vi.fn(async () => block),
  } as unknown as WorkspaceRepository
}

describe('WorkspaceService.assertMembership', () => {
  it('returns the membership DTO when the user is a member', async () => {
    const dto = { workspaceId: 'w1', userId: 'u1', role: 'MEMBER' as const }
    const svc = new WorkspaceService(makeRepo(dto))
    await expect(svc.assertMembership('u1', 'w1')).resolves.toEqual(dto)
  })

  it('throws FORBIDDEN (403) when the user is not a member', async () => {
    const svc = new WorkspaceService(makeRepo(null))
    await expect(svc.assertMembership('u1', 'w1')).rejects.toMatchObject({
      httpStatus: 403,
      message: 'Вы не являетесь участником воркспейса',
    })
    await expect(svc.assertMembership('u1', 'w1')).rejects.toSatisfy(isDomainError)
  })

  it('throws USER_BLOCKED (403) when the member is workspace-blocked', async () => {
    const dto = { workspaceId: 'w1', userId: 'u1', role: 'EDITOR' as const }
    const svc = new WorkspaceService(makeRepo(dto, { id: 'b1' }))
    await expect(svc.assertMembership('u1', 'w1')).rejects.toMatchObject({
      code: 'USER_BLOCKED',
      httpStatus: 403,
      message: 'Доступ заблокирован администратором',
    })
    await expect(svc.assertMembership('u1', 'w1')).rejects.toSatisfy(isDomainError)
  })

  it('does not query the block table for non-members', async () => {
    const repo = makeRepo(null)
    const svc = new WorkspaceService(repo)
    await expect(svc.assertMembership('u1', 'w1')).rejects.toMatchObject({ httpStatus: 403 })
    expect(
      (repo as unknown as { findBlock: ReturnType<typeof vi.fn> }).findBlock,
    ).not.toHaveBeenCalled()
  })
})
