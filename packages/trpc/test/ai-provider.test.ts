import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')

const validateMocks = vi.hoisted(() => ({
  validateLlm: vi.fn(),
  validateEmbedding: vi.fn(),
  validateMcp: vi.fn(),
}))
const planMocks = vi.hoisted(() => ({ getWorkspaceFeatures: vi.fn() }))

vi.mock('@repo/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@repo/db')>()),
  prisma: {},
}))
vi.mock('../src/helpers/agents-validate', () => validateMocks)
vi.mock('../src/helpers/plan', () => planMocks)

import type { PrismaClient } from '@repo/db'
import { aiProviderRouter } from '../src/routers/ai-provider'
import { createCallerFactory } from '../src/trpc'

const WS = '00000000-0000-0000-0000-000000000001'
const USER = '00000000-0000-0000-0000-0000000000aa'
const caller = createCallerFactory(aiProviderRouter)

function ctx(prisma: unknown) {
  return {
    prisma: prisma as PrismaClient,
    user: { id: USER },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

const input = {
  workspaceId: WS,
  kind: 'OPENAI' as const,
  name: 'My OpenAI',
  connection: { apiKey: 'sk-good' },
  model: { slug: 'gpt-4o', displayName: 'GPT-4o', contextTokens: 128000, supportsEmbeddings: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  planMocks.getWorkspaceFeatures.mockResolvedValue({ customAiProvidersEnabled: true })
  validateMocks.validateLlm.mockResolvedValue({ ok: true, error: null })
  validateMocks.validateEmbedding.mockResolvedValue({ ok: true, vectorSize: 768, error: null })
})

describe('aiProvider.create', () => {
  it('blocks save when the ping fails (nothing persisted)', async () => {
    validateMocks.validateLlm.mockResolvedValue({ ok: false, error: 'bad key' })
    const create = vi.fn()
    const prisma = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ aiProvider: { create } })),
    }
    await expect(caller(ctx(prisma)).create(input)).rejects.toThrow(/bad key/)
    expect(create).not.toHaveBeenCalled()
  })

  it('persists with encrypted creds when the ping passes', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'p1', kind: 'OPENAI', name: 'My OpenAI', slug: 'p1', workspaceId: WS,
      connection: {}, connectionEnc: { iv: 'a', ciphertext: 'b', tag: 'c' }, models: [],
    })
    const prisma = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ aiProvider: { create } })),
    }
    const out = await caller(ctx(prisma)).create(input)
    expect((out as { id: string }).id).toBe('p1')
    const arg = create.mock.calls[0][0]
    expect(JSON.stringify(arg)).not.toContain('sk-good')
    expect(arg.data.connectionEnc).toBeDefined()
  })

  it('forbids non-owners', async () => {
    const prisma = { workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) } }
    await expect(caller(ctx(prisma)).create(input)).rejects.toThrow(/прав/)
  })

  it('gates behind the plan flag', async () => {
    planMocks.getWorkspaceFeatures.mockResolvedValue({ customAiProvidersEnabled: false })
    const prisma = { workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) } }
    await expect(caller(ctx(prisma)).create(input)).rejects.toThrow()
  })
})
