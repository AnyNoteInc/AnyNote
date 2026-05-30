import { describe, it, expect, vi } from 'vitest'
import type { Db } from '../../src/shared/unit-of-work.ts'
import { resolveActivePlanOrPersonal, syncWorkspaceLimits } from '../../src/billing/billing.tx.ts'
import { getPlanDisplayName } from '../../src/billing/dto/billing.dto.ts'

const proPlan = { slug: 'pro', name: 'Pro', maxMembersPerWorkspace: 10, maxFileBytes: 100, sortOrder: 5 }
const personalPlan = { slug: 'personal', name: 'Personal', maxMembersPerWorkspace: 3, maxFileBytes: 10, sortOrder: 1 }

function makeClient(overrides: Record<string, unknown> = {}): Db {
  return {
    subscription: { findFirst: vi.fn(async () => null) },
    plan: { findUniqueOrThrow: vi.fn(async () => personalPlan) },
    workspace: { findMany: vi.fn(async () => [{ id: 'w1' }, { id: 'w2' }]) },
    workspaceLimit: { upsert: vi.fn(async () => ({})) },
    ...overrides,
  } as unknown as Db
}

describe('resolveActivePlanOrPersonal (tx carve-out)', () => {
  it("returns the active subscription's plan when one exists", async () => {
    const client = makeClient({ subscription: { findFirst: vi.fn(async () => ({ plan: proPlan })) } })
    expect(await resolveActivePlanOrPersonal(client, 'u1')).toEqual(proPlan)
  })

  it('falls back to the personal plan when there is no active subscription', async () => {
    const findUniqueOrThrow = vi.fn(async () => personalPlan)
    const client = makeClient({ plan: { findUniqueOrThrow } })
    expect(await resolveActivePlanOrPersonal(client, 'u1')).toEqual(personalPlan)
    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { slug: 'personal' } })
  })
})

describe('syncWorkspaceLimits (tx carve-out)', () => {
  it('upserts a workspaceLimit for every workspace the user owns', async () => {
    const upsert = vi.fn(async () => ({}))
    const client = makeClient({
      subscription: { findFirst: vi.fn(async () => ({ plan: proPlan })) },
      workspaceLimit: { upsert },
    })
    await syncWorkspaceLimits(client, 'u1')
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { workspaceId: 'w1' },
        create: expect.objectContaining({ maxMembers: 10, sourcePlanSlug: 'pro' }),
      }),
    )
  })

  it('is a no-op when the user owns no workspaces', async () => {
    const upsert = vi.fn(async () => ({}))
    const client = makeClient({
      subscription: { findFirst: vi.fn(async () => ({ plan: proPlan })) },
      workspace: { findMany: vi.fn(async () => []) },
      workspaceLimit: { upsert },
    })
    await syncWorkspaceLimits(client, 'u1')
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('getPlanDisplayName (pure)', () => {
  it('maps known slugs to Russian display names', () => {
    expect(getPlanDisplayName({ slug: 'personal', name: 'x' })).toBe('Персональный')
    expect(getPlanDisplayName({ slug: 'pro', name: 'x' })).toBe('ПРО')
    expect(getPlanDisplayName({ slug: 'max', name: 'x' })).toBe('МАКС')
  })

  it('falls back to plan.name for unknown slugs', () => {
    expect(getPlanDisplayName({ slug: 'enterprise', name: 'Enterprise' })).toBe('Enterprise')
  })
})
