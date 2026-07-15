import { describe, it, expect, vi } from 'vitest'

import { isDomainError } from '../../../src/shared/errors.ts'
import { hasPlanFeature, type PlanFeatures } from '../../../src/billing/dto/billing.dto.ts'
import { BillingRepository } from '../../../src/billing/repositories/billing.repository.ts'
import { BillingService } from '../../../src/billing/services/billing.service.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'

function features(overrides: Partial<PlanFeatures> = {}): PlanFeatures {
  return {
    slug: 'pro',
    name: 'ПРО',
    sortOrder: 5,
    isPaid: true,
    maxWorkspaces: null,
    maxMembersPerWorkspace: 10,
    chatsEnabled: true,
    pageIndexingEnabled: true,
    membersSettingsEnabled: true,
    aiSettingsEnabled: true,
    customMcpEnabled: true,
    customAiProvidersEnabled: true,
    prioritySupport: true,
    developerSpaceEnabled: true,
    publicSitesEnabled: false,
    meetingsEnabled: false,
    formConditionalLogicEnabled: false,
    formCustomSlugEnabled: false,
    formBrandingRemovalEnabled: false,
    pageHistoryDays: null,
    ...overrides,
  }
}

const planBase = {
  id: 'plan-id',
  name: 'Plan',
  description: null,
  priceMonthlyKopecks: 0,
  priceYearlyKopecks: 0,
  pricePerExtraSeatMonthlyKopecks: 0,
  pricePerExtraSeatYearlyKopecks: 0,
  currency: 'RUB',
  maxWorkspaces: 1,
  maxMembersPerWorkspace: 1,
  maxFileBytes: BigInt(1),
  chatsEnabled: false,
  pageIndexingEnabled: false,
  membersSettingsEnabled: false,
  aiSettingsEnabled: false,
  customMcpEnabled: false,
  customAiProvidersEnabled: false,
  prioritySupport: false,
  developerSpaceEnabled: false,
  sortOrder: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

async function mapRawPlan(slug: 'personal' | 'pro' | 'max', rawFeatures: unknown) {
  const plan = { ...planBase, slug, features: rawFeatures }
  const client = {
    workspace: { findUnique: vi.fn(async () => ({ createdById: 'owner-id' })) },
    subscription: { findFirst: vi.fn(async () => ({ plan })) },
    plan: { findUniqueOrThrow: vi.fn(async () => plan) },
  }
  const uow = {
    client: () => client,
    transaction: vi.fn(),
  } as unknown as UnitOfWork
  return new BillingRepository(uow).getWorkspaceFeatures('workspace-id')
}

describe('form plan features', () => {
  it('recognizes only an exact string token in a raw feature array', () => {
    expect(hasPlanFeature(['forms:conditional'], 'forms:conditional')).toBe(true)
    expect(hasPlanFeature(['forms:conditional '], 'forms:conditional')).toBe(false)
    expect(hasPlanFeature('forms:conditional', 'forms:conditional')).toBe(false)
    expect(hasPlanFeature(null, 'forms:conditional')).toBe(false)
    expect(hasPlanFeature([{ token: 'forms:conditional' }], 'forms:conditional')).toBe(false)
  })

  it.each([
    ['personal', [], false],
    ['pro', ['forms:conditional', 'forms:customSlug', 'forms:hideBranding'], true],
    ['max', ['forms:conditional', 'forms:customSlug', 'forms:hideBranding'], true],
  ] as const)('maps %s form flags from raw tokens', async (slug, rawFeatures, expected) => {
    const result = await mapRawPlan(slug, rawFeatures)
    expect(result).toMatchObject({
      formConditionalLogicEnabled: expected,
      formCustomSlugEnabled: expected,
      formBrandingRemovalEnabled: expected,
    })
  })

  it('does not infer form flags from the plan slug', async () => {
    const personalWithToken = await mapRawPlan('personal', ['forms:conditional'])
    const maxWithoutTokens = await mapRawPlan('max', [])

    expect(personalWithToken.formConditionalLogicEnabled).toBe(true)
    expect(maxWithoutTokens.formConditionalLogicEnabled).toBe(false)
    expect(maxWithoutTokens.formCustomSlugEnabled).toBe(false)
    expect(maxWithoutTokens.formBrandingRemovalEnabled).toBe(false)
  })
})

function makeRepo(
  overrides: Partial<Record<keyof BillingRepository, ReturnType<typeof vi.fn>>> = {},
) {
  return {
    findActiveSubscriptionWithPlan: vi.fn(async () => ({
      id: 's1',
      plan: { slug: 'pro', name: 'Pro' },
    })),
    getWorkspaceFeatures: vi.fn(async () => features()),
    findPlansUpToSortOrder: vi.fn(async () => [{ slug: 'personal' }, { slug: 'pro' }]),
    findAvailableAiModels: vi.fn(async () => [{ id: 'm1' }]),
    findAvailableEmbeddingModels: vi.fn(async () => [{ id: 'e1' }]),
    findWorkspaceOwner: vi.fn(async () => ({
      createdById: 'owner1',
      createdAt: new Date('2026-01-01'),
    })),
    countOlderWorkspaces: vi.fn(async () => 0),
    ...overrides,
  } as unknown as BillingRepository
}

describe('BillingService.getActivePlan', () => {
  it('returns { subscription, plan } when an active subscription exists', async () => {
    const svc = new BillingService(makeRepo())
    const result = await svc.getActivePlan('u1')
    expect(result.plan).toEqual({ slug: 'pro', name: 'Pro' })
  })

  it('throws when the user has no active subscription', async () => {
    const svc = new BillingService(
      makeRepo({ findActiveSubscriptionWithPlan: vi.fn(async () => null) }),
    )
    await expect(svc.getActivePlan('u1')).rejects.toThrow('User u1 has no active subscription')
  })
})

describe('BillingService.getAvailableAiModels', () => {
  it('resolves features → allowed plan slugs → models', async () => {
    const repo = makeRepo({ getWorkspaceFeatures: vi.fn(async () => features({ sortOrder: 5 })) })
    const svc = new BillingService(repo)
    const models = await svc.getAvailableAiModels('w1')
    expect(repo.findPlansUpToSortOrder).toHaveBeenCalledWith(5)
    expect(repo.findAvailableAiModels).toHaveBeenCalledWith('w1', ['personal', 'pro'])
    expect(models).toEqual([{ id: 'm1' }])
  })
})

describe('BillingService.requireWritableWorkspace', () => {
  it('returns without throwing when maxWorkspaces is unlimited (null)', async () => {
    const svc = new BillingService(
      makeRepo({ getWorkspaceFeatures: vi.fn(async () => features({ maxWorkspaces: null })) }),
    )
    await expect(svc.requireWritableWorkspace('w1')).resolves.toBeUndefined()
  })

  it('returns when the owner is under the workspace limit', async () => {
    const svc = new BillingService(
      makeRepo({
        getWorkspaceFeatures: vi.fn(async () => features({ maxWorkspaces: 3 })),
        countOlderWorkspaces: vi.fn(async () => 2),
      }),
    )
    await expect(svc.requireWritableWorkspace('w1')).resolves.toBeUndefined()
  })

  it('throws FORBIDDEN WORKSPACE_OVER_PLAN_LIMIT when at/over the limit', async () => {
    const svc = new BillingService(
      makeRepo({
        getWorkspaceFeatures: vi.fn(async () => features({ maxWorkspaces: 3 })),
        countOlderWorkspaces: vi.fn(async () => 3),
      }),
    )
    await expect(svc.requireWritableWorkspace('w1')).rejects.toMatchObject({
      httpStatus: 403,
      message: 'WORKSPACE_OVER_PLAN_LIMIT',
    })
    await expect(svc.requireWritableWorkspace('w1')).rejects.toSatisfy(isDomainError)
  })

  it('throws NOT_FOUND when the workspace does not exist', async () => {
    const svc = new BillingService(makeRepo({ findWorkspaceOwner: vi.fn(async () => null) }))
    await expect(svc.requireWritableWorkspace('w1')).rejects.toMatchObject({ httpStatus: 404 })
  })
})
