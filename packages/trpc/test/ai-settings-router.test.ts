import { beforeEach, describe, expect, it, vi } from 'vitest'

const planMocks = vi.hoisted(() => ({
  requireWritableWorkspace: vi.fn(async () => undefined),
  getAvailableAiModels: vi.fn(async () => []),
  getAvailableEmbeddingModels: vi.fn(async () => []),
}))

vi.mock('@repo/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return {
    ...actual,
    prisma: {},
  }
})

vi.mock('../src/helpers/plan', () => ({
  requireWritableWorkspace: planMocks.requireWritableWorkspace,
  getAvailableAiModels: planMocks.getAvailableAiModels,
  getAvailableEmbeddingModels: planMocks.getAvailableEmbeddingModels,
}))

import type { PrismaClient } from '@repo/db'
import { PageType } from '@repo/db'

import { aiSettingsRouter } from '../src/routers/ai-settings'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '22222222-2222-2222-2222-222222222222'
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
const MODEL_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const MODEL_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const PAGE_1_ID = '33333333-3333-3333-3333-333333333331'
const PAGE_2_ID = '33333333-3333-3333-3333-333333333332'

function baseContext(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

function embeddingModel(
  id: string,
  overrides: {
    deprecatedAt?: Date | null
    minPlanSlug?: string | null
    provider?: { id: string; slug: string; name: string }
    vectorSize?: number | null
  } = {},
) {
  return {
    id,
    slug: `embedding-${id.slice(0, 4)}`,
    displayName: `Embedding ${id.slice(0, 4)}`,
    deprecatedAt: overrides.deprecatedAt ?? null,
    supportsEmbeddings: true,
    vectorSize: overrides.vectorSize ?? 1536,
    minPlanSlug: overrides.minPlanSlug ?? null,
    provider: overrides.provider ?? {
      id: '44444444-4444-4444-4444-444444444444',
      slug: 'openai',
      name: 'OpenAI',
    },
  }
}

function createPrismaMock(existingEmbeddingsModelId: string | null) {
  const upsertResult = {
    workspaceId: WORKSPACE_ID,
    defaultModelId: null,
    embeddingsModelId: existingEmbeddingsModelId,
    systemPrompt: null,
    temperature: 0.2,
    topP: 0.5,
  }
  const tx = {
    workspaceAiSettings: {
      upsert: vi.fn(async ({ update }: { update: { embeddingsModelId?: string | null } }) => ({
        ...upsertResult,
        embeddingsModelId:
          update.embeddingsModelId === undefined
            ? existingEmbeddingsModelId
            : update.embeddingsModelId,
      })),
    },
    outboxEvent: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 2 })),
    },
    page: {
      findMany: vi.fn(async () => [{ id: PAGE_1_ID }, { id: PAGE_2_ID }]),
    },
  }
  const prisma = {
    workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    workspaceAiSettings: {
      findUnique: vi.fn(async () => ({
        workspaceId: WORKSPACE_ID,
        embeddingsModelId: existingEmbeddingsModelId,
      })),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient

  return { prisma, tx }
}

describe('aiSettings embedding model queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('groups available non-deprecated embedding models by provider', async () => {
    planMocks.getAvailableEmbeddingModels.mockResolvedValue([
      embeddingModel(MODEL_A_ID, {
        minPlanSlug: 'pro',
        provider: {
          id: '55555555-5555-5555-5555-555555555555',
          slug: 'z-provider',
          name: 'Z Provider',
        },
      }),
      embeddingModel(MODEL_B_ID, {
        deprecatedAt: new Date(),
        provider: {
          id: '44444444-4444-4444-4444-444444444444',
          slug: 'a-provider',
          name: 'A Provider',
        },
      }),
    ])
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    } as unknown as PrismaClient
    const caller = createCallerFactory(aiSettingsRouter)(baseContext(prisma))

    const result = await caller.listAvailableEmbeddingModels({ workspaceId: WORKSPACE_ID })

    expect(result).toEqual([
      {
        id: '55555555-5555-5555-5555-555555555555',
        slug: 'z-provider',
        name: 'Z Provider',
        models: [
          {
            id: MODEL_A_ID,
            slug: 'embedding-aaaa',
            displayName: 'Embedding aaaa',
            vectorSize: 1536,
            minPlanSlug: 'pro',
          },
        ],
      },
    ])
  })

  it('returns embeddingsModelId from aiSettings.get', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      workspaceAiSettings: {
        findUnique: vi.fn(async () => ({
          workspaceId: WORKSPACE_ID,
          defaultModelId: null,
          embeddingsModelId: MODEL_A_ID,
          systemPrompt: null,
          temperature: 0.2,
          topP: 0.5,
        })),
      },
    } as unknown as PrismaClient
    const caller = createCallerFactory(aiSettingsRouter)(baseContext(prisma))

    await expect(caller.get({ workspaceId: WORKSPACE_ID })).resolves.toMatchObject({
      embeddingsModelId: MODEL_A_ID,
    })
  })
})

describe('aiSettings.update embeddings model change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planMocks.requireWritableWorkspace.mockResolvedValue(undefined)
    planMocks.getAvailableEmbeddingModels.mockResolvedValue([
      embeddingModel(MODEL_A_ID),
      embeddingModel(MODEL_B_ID),
    ])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
  })

  it('does not enqueue events or wipe vectors when embeddingsModelId is unchanged', async () => {
    const { prisma, tx } = createPrismaMock(MODEL_A_ID)
    const caller = createCallerFactory(aiSettingsRouter)(baseContext(prisma))

    await caller.update({ workspaceId: WORKSPACE_ID, embeddingsModelId: MODEL_A_ID })

    expect(tx.outboxEvent.updateMany).not.toHaveBeenCalled()
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels pending page outbox events, enqueues text pages, and wipes vectors on change A to B', async () => {
    const { prisma, tx } = createPrismaMock(MODEL_A_ID)
    const caller = createCallerFactory(aiSettingsRouter)(baseContext(prisma))

    await caller.update({ workspaceId: WORKSPACE_ID, embeddingsModelId: MODEL_B_ID })

    expect(tx.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: {
        aggregateType: 'page',
        workspaceId: WORKSPACE_ID,
        status: 'PENDING',
      },
      data: expect.objectContaining({ status: 'DONE' }),
    })
    expect(tx.page.findMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, deletedAt: null, type: PageType.TEXT },
      select: { id: true },
    })
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: PAGE_1_ID,
          workspaceId: WORKSPACE_ID,
        },
        {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: PAGE_2_ID,
          workspaceId: WORKSPACE_ID,
        },
      ],
    })
    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:8080/vectorization/workspaces/${WORKSPACE_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('cancels pending page outbox events without enqueueing pages and wipes vectors on change A to null', async () => {
    const { prisma, tx } = createPrismaMock(MODEL_A_ID)
    const caller = createCallerFactory(aiSettingsRouter)(baseContext(prisma))

    await caller.update({ workspaceId: WORKSPACE_ID, embeddingsModelId: null })

    expect(tx.outboxEvent.updateMany).toHaveBeenCalled()
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
  })
})
