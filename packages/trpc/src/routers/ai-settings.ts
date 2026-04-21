import { z } from "zod"
import { TRPCError } from "@trpc/server"
import type { AiModel, AiProvider, Prisma } from "@repo/db"

import { router, protectedProcedure } from "../trpc"

async function assertWorkspaceMember(
  ctx: { prisma: Prisma.TransactionClient | typeof import("@repo/db").prisma; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Нет доступа к workspace" })
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
  listAvailableModels: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(
      async ({
        ctx,
        input,
      }): Promise<
        Array<
          Pick<AiProvider, "id" | "slug" | "name"> & {
            models: Array<
              Pick<
                AiModel,
                "id" | "slug" | "displayName" | "contextTokens" | "supportsVision" | "minPlanSlug"
              >
            >
          }
        >
      > => {
        await assertWorkspaceMember(ctx, input.workspaceId)
        const providers = await ctx.prisma.aiProvider.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: {
            id: true,
            slug: true,
            name: true,
            models: {
              where: { isActive: true, deprecatedAt: null },
              orderBy: { displayName: "asc" },
              select: {
                id: true,
                slug: true,
                displayName: true,
                contextTokens: true,
                supportsVision: true,
                minPlanSlug: true,
              },
            },
          },
        })
        return providers
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
      if (input.defaultModelId) {
        const model = await ctx.prisma.aiModel.findUnique({
          where: { id: input.defaultModelId },
          select: { id: true, isActive: true },
        })
        if (!model || !model.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Недоступная модель" })
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
        ...(data as Omit<Prisma.WorkspaceAiSettingsCreateInput, "workspace">),
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
