import { describe, it, expect, vi } from 'vitest'

import { isDomainError } from '../../../src/shared/errors.ts'
import type { WorkspaceRepository } from '../../../src/workspace/repositories/workspace.repository.ts'
import { WorkspaceService } from '../../../src/workspace/services/workspace.service.ts'

function makeRepo(membership: unknown) {
  return { findMembership: vi.fn(async () => membership) } as unknown as WorkspaceRepository
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
    await svc.assertMembership('u1', 'w1').catch((e) => {
      expect(isDomainError(e)).toBe(true)
    })
  })
})
