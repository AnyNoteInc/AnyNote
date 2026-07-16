import { describe, expect, it, vi } from 'vitest'

import type { BillingService } from '../../src/billing/services/billing.service.ts'
import type { CollectionService } from '../../src/collections/services/collection.service.ts'
import type { PeopleRepository } from '../../src/people/repositories/people.repository.ts'
import { PeopleService } from '../../src/people/services/people.service.ts'
import type { UnitOfWork } from '../../src/shared/unit-of-work.ts'

const WORKSPACE_ID = '00000000-0000-7000-8000-000000000001'
const ACTOR_ID = '00000000-0000-7000-8000-000000000002'
const MEMBER_ID = '00000000-0000-7000-8000-000000000003'

function makeHarness() {
  const lockOrder: string[] = []
  const repo = {
    findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
    countOwners: vi.fn(async () => 2),
    findUserById: vi.fn(async () => ({ email: 'member@example.test' })),
    updateMemberRole: vi.fn(async () => {
      lockOrder.push('membership')
    }),
    deleteMember: vi.fn(async () => {
      lockOrder.push('membership')
    }),
    recordMemberEvent: vi.fn(async () => undefined),
    writeAudit: vi.fn(async () => undefined),
  } as unknown as PeopleRepository
  const uow = {
    transaction: vi.fn(async (run: () => Promise<unknown>) => run()),
    client: vi.fn(() => ({
      $queryRaw: vi.fn(async () => {
        lockOrder.push('workspace')
        return [{ id: WORKSPACE_ID }]
      }),
    })),
  } as unknown as UnitOfWork
  const service = new PeopleService(repo, uow, {} as CollectionService, {} as BillingService)
  return { service, lockOrder }
}

describe('PeopleService membership mutation lock order', () => {
  it('locks the workspace before changing a member role', async () => {
    const { service, lockOrder } = makeHarness()

    await service.changeMemberRole({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      actorRole: 'OWNER',
      userId: MEMBER_ID,
      role: 'ADMIN',
    })

    expect(lockOrder.slice(0, 2)).toEqual(['workspace', 'membership'])
  })

  it('locks the workspace before removing a member', async () => {
    const { service, lockOrder } = makeHarness()

    await service.removeMember({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      actorRole: 'OWNER',
      userId: MEMBER_ID,
    })

    expect(lockOrder.slice(0, 2)).toEqual(['workspace', 'membership'])
  })
})
