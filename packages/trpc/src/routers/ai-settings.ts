import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { AiModel, AiProvider, Prisma } from '@repo/db'

import { router, protectedProcedure } from '../trpc'
import {
  getAvailableAiModels,
  getAvailableEmbeddingModels,
  requireWritableWorkspace,
} from '../helpers/plan'

async function wipeAgentsWorkspaceVectors(workspaceId: string): Promise<void> {
  const baseUrl = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  const ctl = new AbortController()
  const timeout = setTimeout(() => ctl.abort(), 30_000)

  try {
    const res = await fetch(`${baseUrl}/vectorization/workspaces/${workspaceId}`, {
      method: 'DELETE',
      signal: ctl.signal,
    })
    if (!res.ok) {
      throw new Error(`agents DELETE workspace ${res.status}: ${await res.text()}`)
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function assertWorkspaceMember(
  ctx: {
    prisma: Prisma.TransactionClient | typeof import('@repo/db').prisma
    user: { id: string }
  },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа к workspace' })
  }
  return member
}

export interface AiSettingsResult {
  workspaceId: string
  defaultModelId: string | null
  embeddingsModelId: string | null
  systemPrompt: string | null
  temperature: number
  topP: number
}

export const aiSettingsRouter = router({
  /** List AI providers + models the workspace's plan allows. */
  listAvailableModels: protectedProcedure.input(z.object({ workspaceId: z.string().uuid() })).query(
    async ({
      ctx,
      input,
    }): Promise<
      Array<
        Pick<AiProvider, 'id' | 'slug' | 'name'> & {
          models: Array<
            Pick<
              AiModel,
              'id' | 'slug' | 'displayName' | 'contextTokens' | 'supportsVision' | 'minPlanSlug'
            >
          >
        }
      >
    > => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const models = await getAvailableAiModels(input.workspaceId)
      const byProvider = new Map<
        string,
        Pick<AiProvider, 'id' | 'slug' | 'name'> & {
          models: Array<
            Pick<
              AiModel,
              'id' | 'slug' | 'displayName' | 'contextTokens' | 'supportsVision' | 'minPlanSlug'
            >
          >
        }
      >()

      for (const model of models.filter((m) => m.deprecatedAt === null)) {
        const provider =
          byProvider.get(model.provider.id) ??
          ({
            id: model.provider.id,
            slug: model.provider.slug,
            name: model.provider.name,
            models: [],
          } satisfies Pick<AiProvider, 'id' | 'slug' | 'name'> & {
            models: Array<
              Pick<
                AiModel,
                'id' | 'slug' | 'displayName' | 'contextTokens' | 'supportsVision' | 'minPlanSlug'
              >
            >
          })
        provider.models.push({
          id: model.id,
          slug: model.slug,
          displayName: model.displayName,
          contextTokens: model.contextTokens,
          supportsVision: model.supportsVision,
          minPlanSlug: model.minPlanSlug,
        })
        byProvider.set(provider.id, provider)
      }

      return [...byProvider.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
  ),

  /** List embedding providers + models the workspace's plan allows. */
  listAvailableEmbeddingModels: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(
      async ({
        ctx,
        input,
      }): Promise<
        Array<
          Pick<AiProvider, 'id' | 'slug' | 'name'> & {
            models: Array<
              Pick<AiModel, 'id' | 'slug' | 'displayName' | 'vectorSize' | 'minPlanSlug'>
            >
          }
        >
      > => {
        await assertWorkspaceMember(ctx, input.workspaceId)
        const models = await getAvailableEmbeddingModels(input.workspaceId)
        const byProvider = new Map<
          string,
          Pick<AiProvider, 'id' | 'slug' | 'name'> & {
            models: Array<
              Pick<AiModel, 'id' | 'slug' | 'displayName' | 'vectorSize' | 'minPlanSlug'>
            >
          }
        >()

        for (const model of models.filter((m) => m.deprecatedAt === null)) {
          const provider =
            byProvider.get(model.provider.id) ??
            ({
              id: model.provider.id,
              slug: model.provider.slug,
              name: model.provider.name,
              models: [],
            } satisfies Pick<AiProvider, 'id' | 'slug' | 'name'> & {
              models: Array<
                Pick<AiModel, 'id' | 'slug' | 'displayName' | 'vectorSize' | 'minPlanSlug'>
              >
            })
          provider.models.push({
            id: model.id,
            slug: model.slug,
            displayName: model.displayName,
            vectorSize: model.vectorSize,
            minPlanSlug: model.minPlanSlug,
          })
          byProvider.set(provider.id, provider)
        }

        return [...byProvider.values()].sort((a, b) => a.name.localeCompare(b.name))
      },
    ),

  get: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<AiSettingsResult> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const settings = await ctx.prisma.workspaceAiSettings.findUnique({
        where: { workspaceId: input.workspaceId },
      })
      return {
        workspaceId: input.workspaceId,
        defaultModelId: settings?.defaultModelId ?? null,
        embeddingsModelId: settings?.embeddingsModelId ?? null,
        systemPrompt: settings?.systemPrompt ?? null,
        temperature: settings?.temperature ?? 0.2,
        topP: settings?.topP ?? 0.5,
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        defaultModelId: z.string().uuid().nullable().optional(),
        embeddingsModelId: z.string().uuid().nullable().optional(),
        systemPrompt: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<AiSettingsResult> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      if (input.defaultModelId) {
        const availableModels = await getAvailableAiModels(input.workspaceId)
        const model = availableModels.find((m) => m.id === input.defaultModelId)
        if (!model || model.deprecatedAt !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Недоступная модель' })
        }
      }

      if (input.embeddingsModelId) {
        const availableEmbeddingModels = await getAvailableEmbeddingModels(input.workspaceId)
        const model = availableEmbeddingModels.find((m) => m.id === input.embeddingsModelId)
        if (
          !model ||
          model.deprecatedAt !== null ||
          !model.supportsEmbeddings ||
          model.vectorSize === null
        ) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Недоступная модель векторизации' })
        }
      }

      const before = await ctx.prisma.workspaceAiSettings.findUnique({
        where: { workspaceId: input.workspaceId },
      })
      const oldEmbeddingsModelId = before?.embeddingsModelId ?? null
      const newEmbeddingsModelId =
        input.embeddingsModelId === undefined ? oldEmbeddingsModelId : input.embeddingsModelId
      const embeddingsModelChanged = oldEmbeddingsModelId !== newEmbeddingsModelId

      const upserted = await ctx.prisma.$transaction(async (tx) => {
        const createData: Prisma.WorkspaceAiSettingsUncheckedCreateInput = {
          workspaceId: input.workspaceId,
        }
        const updateData: Prisma.WorkspaceAiSettingsUncheckedUpdateInput = {}

        if (input.defaultModelId !== undefined) {
          createData.defaultModelId = input.defaultModelId
          updateData.defaultModelId = input.defaultModelId
        }
        if (input.embeddingsModelId !== undefined) {
          createData.embeddingsModelId = input.embeddingsModelId
          updateData.embeddingsModelId = input.embeddingsModelId
        }
        if (input.systemPrompt !== undefined) {
          const systemPrompt =
            input.systemPrompt === null ? null : input.systemPrompt.trim() || null
          createData.systemPrompt = systemPrompt
          updateData.systemPrompt = systemPrompt
        }

        const result = await tx.workspaceAiSettings.upsert({
          where: { workspaceId: input.workspaceId },
          create: createData,
          update: updateData,
        })

        if (embeddingsModelChanged) {
          await tx.outboxEvent.updateMany({
            where: {
              aggregateType: 'page',
              workspaceId: input.workspaceId,
              status: 'PENDING',
            },
            data: { status: 'DONE', processedAt: new Date() },
          })

          if (newEmbeddingsModelId !== null) {
            const pages = await tx.page.findMany({
              where: { workspaceId: input.workspaceId, deletedAt: null, type: 'TEXT' },
              select: { id: true },
            })
            const batchSize = 5_000
            for (let i = 0; i < pages.length; i += batchSize) {
              const slice = pages.slice(i, i + batchSize)
              await tx.outboxEvent.createMany({
                data: slice.map((page) => ({
                  eventType: 'page.upserted',
                  aggregateType: 'page',
                  aggregateId: page.id,
                  workspaceId: input.workspaceId,
                })),
              })
            }
          }
        }

        return result
      })

      if (embeddingsModelChanged) {
        try {
          await wipeAgentsWorkspaceVectors(input.workspaceId)
        } catch (err) {
          console.error('wipe workspace vectors failed', { err, workspaceId: input.workspaceId })
        }
      }

      return {
        workspaceId: upserted.workspaceId,
        defaultModelId: upserted.defaultModelId,
        embeddingsModelId: upserted.embeddingsModelId,
        systemPrompt: upserted.systemPrompt,
        temperature: upserted.temperature,
        topP: upserted.topP,
      }
    }),
})
