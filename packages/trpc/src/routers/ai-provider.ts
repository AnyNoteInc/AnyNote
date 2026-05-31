import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@repo/db'
import { parseAiProviderConnection } from '@repo/db'
import { decryptSecret, encryptSecret, type EncryptedPayload } from '@repo/auth'

import { router, protectedProcedure } from '../trpc'
import { getWorkspaceFeatures } from '../helpers/plan'
import { validateEmbedding, validateLlm, type AgentsServiceAuth, type ProviderConnectionInput } from '../helpers/agents-validate'

const kindSchema = z.enum(['OLLAMA', 'OPENAI', 'GIGACHAT', 'YANDEXGPT', 'ANTHROPIC', 'DEEPSEEK'])

const connectionSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  organization: z.string().optional(),
  scope: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  folderId: z.string().optional(),
})

const modelInput = z.object({
  slug: z.string().min(1).max(100),
  displayName: z.string().min(1).max(150),
  contextTokens: z.number().int().positive(),
  supportsVision: z.boolean().default(false),
  supportsEmbeddings: z.boolean().default(false),
  supportsReasoning: z.boolean().default(false),
})

async function assertOwner(ctx: { prisma: PrismaClient; user: { id: string } }, workspaceId: string) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || member.role !== 'OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
}

async function assertPlan(workspaceId: string) {
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.customAiProvidersEnabled) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'CUSTOM_AI_PROVIDERS_NOT_IN_PLAN' })
  }
}

function stripCreds<T extends Record<string, unknown>>(row: T): Omit<T, 'connection' | 'connectionEnc'> {
  const copy = { ...row } as T & { connection?: unknown; connectionEnc?: unknown }
  delete copy.connection
  delete copy.connectionEnc
  return copy
}

function decryptConnection(connectionEnc: unknown): ProviderConnectionInput {
  if (!connectionEnc) return {}
  try {
    return JSON.parse(decryptSecret(connectionEnc as EncryptedPayload)) as ProviderConnectionInput
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Учётные данные провайдера повреждены или изменён ключ шифрования',
    })
  }
}

function normalizeConnection(
  kind: z.infer<typeof kindSchema>,
  raw: z.infer<typeof connectionSchema>,
): ProviderConnectionInput {
  let parsed: Record<string, unknown>
  try {
    parsed = parseAiProviderConnection(kind.toLowerCase(), raw) as unknown as Record<string, unknown>
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Некорректные параметры подключения для провайдера' })
  }
  const out: ProviderConnectionInput = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (k !== 'provider' && typeof v === 'string') out[k] = v
  }
  return out
}

// Pings a model against a connection; throws TRPCError on failure. Returns detected vectorSize for embeddings.
async function pingModel(args: {
  kind: z.infer<typeof kindSchema>
  modelSlug: string
  supportsEmbeddings: boolean
  connection: ProviderConnectionInput
  auth: AgentsServiceAuth
}): Promise<number | null> {
  const provider = args.kind.toLowerCase()
  if (args.supportsEmbeddings) {
    const res = await validateEmbedding(
      { provider, modelSlug: args.modelSlug, connection: args.connection },
      args.auth,
    )
    if (!res.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: `Не удалось подключиться: ${res.error}` })
    if (res.vectorSize == null || res.vectorSize < 1) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Провайдер вернул некорректную размерность вектора' })
    }
    return res.vectorSize
  }
  const res = await validateLlm({ provider, name: args.modelSlug, connection: args.connection }, args.auth)
  if (!res.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: `Не удалось подключиться: ${res.error}` })
  return null
}

export const aiProviderRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      const rows = await ctx.prisma.aiProvider.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'asc' },
        include: { models: { orderBy: { displayName: 'asc' } } },
      })
      return rows.map(stripCreds)
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        kind: kindSchema,
        name: z.string().min(1).max(100),
        connection: connectionSchema,
        model: modelInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      await assertPlan(input.workspaceId)
      const connection = normalizeConnection(input.kind, input.connection)
      const vectorSize = await pingModel({
        kind: input.kind,
        modelSlug: input.model.slug,
        supportsEmbeddings: input.model.supportsEmbeddings,
        connection,
        auth: { userId: ctx.user.id, workspaceId: input.workspaceId },
      })
      const encrypted = encryptSecret(JSON.stringify(connection))
      const provider = await ctx.prisma.aiProvider.create({
        data: {
          workspaceId: input.workspaceId,
          kind: input.kind,
          slug: randomUUID(),
          name: input.name,
          connection: {},
          connectionEnc: encrypted as unknown as object,
          createdById: ctx.user.id,
          models: {
            create: {
              slug: input.model.slug,
              displayName: input.model.displayName,
              contextTokens: input.model.contextTokens,
              supportsVision: input.model.supportsVision,
              supportsEmbeddings: input.model.supportsEmbeddings,
              supportsReasoning: input.model.supportsReasoning,
              vectorSize,
            },
          },
        },
        include: { models: true },
      })
      return stripCreds(provider)
    }),

  addModel: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), providerId: z.string().uuid(), model: modelInput }))
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      await assertPlan(input.workspaceId)
      const provider = await ctx.prisma.aiProvider.findFirst({
        where: { id: input.providerId, workspaceId: input.workspaceId },
      })
      if (!provider) throw new TRPCError({ code: 'NOT_FOUND' })
      const connection = decryptConnection(provider.connectionEnc)
      const vectorSize = await pingModel({
        kind: provider.kind,
        modelSlug: input.model.slug,
        supportsEmbeddings: input.model.supportsEmbeddings,
        connection,
        auth: { userId: ctx.user.id, workspaceId: input.workspaceId },
      })
      return ctx.prisma.aiModel.create({
        data: {
          providerId: provider.id,
          slug: input.model.slug,
          displayName: input.model.displayName,
          contextTokens: input.model.contextTokens,
          supportsVision: input.model.supportsVision,
          supportsEmbeddings: input.model.supportsEmbeddings,
          supportsReasoning: input.model.supportsReasoning,
          vectorSize,
        },
      })
    }),

  deleteModel: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), modelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      const model = await ctx.prisma.aiModel.findFirst({
        where: { id: input.modelId, provider: { workspaceId: input.workspaceId } },
      })
      if (!model) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.prisma.aiModel.delete({ where: { id: input.modelId } })
      return { ok: true as const }
    }),

  delete: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), providerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      const provider = await ctx.prisma.aiProvider.findFirst({
        where: { id: input.providerId, workspaceId: input.workspaceId },
      })
      if (!provider) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.prisma.aiProvider.delete({ where: { id: input.providerId } })
      return { ok: true as const }
    }),
})
