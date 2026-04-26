import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { AiModel, AiProvider, Prisma } from '@repo/db'

import { router, protectedProcedure } from '../trpc'
import { getAvailableAiModels, requireWritableWorkspace } from '../helpers/plan'

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
      const data: Prisma.WorkspaceAiSettingsCreateInput | Prisma.WorkspaceAiSettingsUpdateInput = {}
      if (input.defaultModelId !== undefined) {
        ;(data as Prisma.WorkspaceAiSettingsUpdateInput).defaultModel = input.defaultModelId
          ? { connect: { id: input.defaultModelId } }
          : { disconnect: true }
      }
      if (input.systemPrompt !== undefined) {
        data.systemPrompt = input.systemPrompt === null ? null : input.systemPrompt.trim() || null
      }

      const createData: Prisma.WorkspaceAiSettingsCreateInput = {
        workspace: { connect: { id: input.workspaceId } },
        ...(data as Omit<Prisma.WorkspaceAiSettingsCreateInput, 'workspace'>),
      }
      const upserted = await ctx.prisma.workspaceAiSettings.upsert({
        where: { workspaceId: input.workspaceId },
        create: createData,
        update: data as Prisma.WorkspaceAiSettingsUpdateInput,
      })

      return {
        workspaceId: upserted.workspaceId,
        defaultModelId: upserted.defaultModelId,
        systemPrompt: upserted.systemPrompt,
        temperature: upserted.temperature,
        topP: upserted.topP,
      }
    }),
})
