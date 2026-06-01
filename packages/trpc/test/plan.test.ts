import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/db'
import {
  getWorkspaceFeatures,
  getAvailableAiModels,
  getAvailableEmbeddingModels,
  requireWritableWorkspace,
} from '../src/helpers/plan'

// The seed no longer creates global AI providers/models (they are managed in
// production, not re-created by `prisma db seed`). So the model-availability
// tests below seed their OWN fixtures instead of assuming seed data exists —
// otherwise they pass only against a stale local DB and fail on a fresh CI DB.
const TEST_PROVIDER_SLUG = 'plan-test-provider'

type ModelFixture = {
  slug: string
  displayName: string
  supportsEmbeddings: boolean
  vectorSize: number | null
  minPlanSlug: string | null
}

// Filtering is driven by supportsEmbeddings/vectorSize/minPlanSlug (see
// billing.repository.ts findAvailableAiModels/findAvailableEmbeddingModels).
const MODEL_FIXTURES: ModelFixture[] = [
  // chat models
  { slug: 'gigachat-2', displayName: 'GigaChat 2', supportsEmbeddings: false, vectorSize: null, minPlanSlug: null },
  { slug: 'gigachat-2-pro', displayName: 'GigaChat 2 Pro', supportsEmbeddings: false, vectorSize: null, minPlanSlug: 'pro' },
  { slug: 'gigachat-2-max', displayName: 'GigaChat 2 Max', supportsEmbeddings: false, vectorSize: null, minPlanSlug: 'max' },
  // embedding models
  { slug: 'nomic-embed-text', displayName: 'Nomic Embed Text', supportsEmbeddings: true, vectorSize: 768, minPlanSlug: null },
  { slug: 'bge-m3', displayName: 'BGE-M3', supportsEmbeddings: true, vectorSize: 1024, minPlanSlug: null },
  { slug: 'text-embedding-3-small', displayName: 'Text Embedding 3 Small', supportsEmbeddings: true, vectorSize: 1536, minPlanSlug: null },
  { slug: 'embeddings', displayName: 'Embeddings', supportsEmbeddings: true, vectorSize: 512, minPlanSlug: null },
  { slug: 'text-embedding-3-large', displayName: 'Text Embedding 3 Large', supportsEmbeddings: true, vectorSize: 3072, minPlanSlug: 'max' },
]

async function cleanupTestModels(): Promise<void> {
  // Deleting the provider cascades to its models (onDelete: Cascade).
  await prisma.aiProvider.deleteMany({ where: { slug: TEST_PROVIDER_SLUG, workspaceId: null } })
}

async function seedTestModels(): Promise<void> {
  await cleanupTestModels()
  const provider = await prisma.aiProvider.create({
    data: { slug: TEST_PROVIDER_SLUG, name: 'Plan Test Provider', kind: 'GIGACHAT', workspaceId: null },
    select: { id: true },
  })
  await prisma.aiModel.createMany({
    data: MODEL_FIXTURES.map((m) => ({
      providerId: provider.id,
      slug: m.slug,
      displayName: m.displayName,
      contextTokens: 8192,
      supportsEmbeddings: m.supportsEmbeddings,
      vectorSize: m.vectorSize,
      minPlanSlug: m.minPlanSlug,
    })),
  })
}

describe('getWorkspaceFeatures', () => {
  let workspaceId: string
  let ownerId: string

  beforeEach(async () => {
    // clean fixtures from previous runs
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: '+plan-test@anynote.dev' } } },
    })
    await prisma.workspace.deleteMany({
      where: { createdBy: { email: { contains: '+plan-test@anynote.dev' } } },
    })
    await prisma.user.deleteMany({
      where: { email: { contains: '+plan-test@anynote.dev' } },
    })

    const owner = await prisma.user.create({
      data: {
        email: 'wf+plan-test@anynote.dev',
        emailVerified: true,
        name: 'Test',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    ownerId = owner.id
    const ws = await prisma.workspace.create({
      data: { name: 'Test WS', createdById: owner.id },
      select: { id: true },
    })
    workspaceId = ws.id
  })

  it('returns personal features when owner has no active subscription', async () => {
    const features = await getWorkspaceFeatures(workspaceId)
    expect(features.slug).toBe('personal')
    expect(features.chatsEnabled).toBe(false)
    expect(features.isPaid).toBe(false)
  })

  it('returns pro features when owner has ACTIVE pro subscription', async () => {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: {
        userId: ownerId,
        planId: pro.id,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    })
    const features = await getWorkspaceFeatures(workspaceId)
    expect(features.slug).toBe('pro')
    expect(features.chatsEnabled).toBe(true)
    expect(features.isPaid).toBe(true)
    expect(features.maxMembersPerWorkspace).toBe(5)
  })
})

describe('getAvailableAiModels', () => {
  let workspaceId: string
  let ownerId: string

  beforeEach(async () => {
    // clean fixtures from previous runs
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: '+plan-test@anynote.dev' } } },
    })
    await prisma.workspace.deleteMany({
      where: { createdBy: { email: { contains: '+plan-test@anynote.dev' } } },
    })
    await prisma.user.deleteMany({
      where: { email: { contains: '+plan-test@anynote.dev' } },
    })
    await seedTestModels()

    const owner = await prisma.user.create({
      data: {
        email: 'wf+plan-test@anynote.dev',
        emailVerified: true,
        name: 'Test',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    ownerId = owner.id
    const ws = await prisma.workspace.create({
      data: { name: 'Test WS', createdById: owner.id },
      select: { id: true },
    })
    workspaceId = ws.id
  })

  afterAll(cleanupTestModels)

  it('returns models with minPlanSlug=null and Pro-eligible models for Pro workspace', async () => {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: {
        userId: ownerId,
        planId: pro.id,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    })
    const models = await getAvailableAiModels(workspaceId)
    const slugs = models.map((m) => m.slug).sort()
    // assumes seed ran; we expect at minimum gigachat-2 and gigachat-2-pro
    expect(slugs).toContain('gigachat-2')
    expect(slugs).toContain('gigachat-2-pro')
    expect(slugs).not.toContain('nomic-embed-text')
    expect(slugs).not.toContain('text-embedding-3-small')
    expect(slugs).not.toContain('embeddings')
    // should NOT include gigachat-2-max (requires Max plan)
    expect(slugs).not.toContain('gigachat-2-max')
  })

  it('returns no Max-only models for Personal workspace', async () => {
    // no subscription created → defaults to personal
    const models = await getAvailableAiModels(workspaceId)
    const slugs = models.map((m) => m.slug)
    expect(slugs).not.toContain('gigachat-2-pro')
    expect(slugs).not.toContain('gigachat-2-max')
  })
})

describe('getAvailableEmbeddingModels', () => {
  let workspaceId: string
  let ownerId: string

  beforeEach(async () => {
    // clean fixtures from previous runs
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: '+plan-test@anynote.dev' } } },
    })
    await prisma.workspace.deleteMany({
      where: { createdBy: { email: { contains: '+plan-test@anynote.dev' } } },
    })
    await prisma.user.deleteMany({
      where: { email: { contains: '+plan-test@anynote.dev' } },
    })
    await seedTestModels()

    const owner = await prisma.user.create({
      data: {
        email: 'wf+plan-test@anynote.dev',
        emailVerified: true,
        name: 'Test',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    ownerId = owner.id
    const ws = await prisma.workspace.create({
      data: { name: 'Test WS', createdById: owner.id },
      select: { id: true },
    })
    workspaceId = ws.id
  })

  afterAll(cleanupTestModels)

  it('returns only Pro-eligible embedding models for Pro workspace', async () => {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: {
        userId: ownerId,
        planId: pro.id,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    })

    const models = await getAvailableEmbeddingModels(workspaceId)
    const slugs = models.map((m) => m.slug).sort()

    expect(slugs).toContain('nomic-embed-text')
    expect(slugs).toContain('bge-m3')
    expect(slugs).toContain('text-embedding-3-small')
    expect(slugs).toContain('embeddings')
    expect(slugs).not.toContain('text-embedding-3-large')
    expect(slugs).not.toContain('gigachat-2')
  })
})

describe('requireWritableWorkspace', () => {
  let workspaceId: string
  let ownerId: string

  beforeEach(async () => {
    // clean fixtures from previous runs
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: '+plan-test@anynote.dev' } } },
    })
    await prisma.workspace.deleteMany({
      where: { createdBy: { email: { contains: '+plan-test@anynote.dev' } } },
    })
    await prisma.user.deleteMany({
      where: { email: { contains: '+plan-test@anynote.dev' } },
    })

    const owner = await prisma.user.create({
      data: {
        email: 'wf+plan-test@anynote.dev',
        emailVerified: true,
        name: 'Test',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    ownerId = owner.id
    const ws = await prisma.workspace.create({
      data: { name: 'WS1', createdById: owner.id },
      select: { id: true },
    })
    workspaceId = ws.id
  })

  it('allows writes for first workspace on Personal (within limit)', async () => {
    await expect(requireWritableWorkspace(workspaceId)).resolves.toBeUndefined()
  })

  it('blocks writes for second workspace on Personal (over limit)', async () => {
    const second = await prisma.workspace.create({
      data: { name: 'WS2', createdById: ownerId },
      select: { id: true },
    })
    await expect(requireWritableWorkspace(second.id)).rejects.toThrow(/WORKSPACE_OVER_PLAN_LIMIT/)
  })

  it('allows writes for unlimited Max plan regardless of count', async () => {
    const max = await prisma.plan.findUniqueOrThrow({ where: { slug: 'max' } })
    await prisma.subscription.create({
      data: {
        userId: ownerId,
        planId: max.id,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    })
    // create extra workspaces — should still work
    await prisma.workspace.create({ data: { name: 'WS2', createdById: ownerId } })
    const ws3 = await prisma.workspace.create({
      data: { name: 'WS3', createdById: ownerId },
      select: { id: true },
    })
    await expect(requireWritableWorkspace(ws3.id)).resolves.toBeUndefined()
  })
})
