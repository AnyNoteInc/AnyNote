import { z } from "zod"
import { TRPCError } from "@trpc/server"
import type { AiModel, AiProvider, Prisma, WorkspaceAiSettings } from "@repo/db"

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
  systemPromptPageId: string | null
  temperature: number | null
  maxOutputTokens: number | null
  topP: number | null
  providerCredentials: Record<string, Record<string, string>>
  skillPageIds: string[]
}

const ProviderKeysSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), z.string()),
)

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
                | "id"
                | "slug"
                | "displayName"
                | "contextTokens"
                | "maxOutputTokens"
                | "supportsVision"
                | "supportsFunctionCalling"
                | "minPlanSlug"
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
                maxOutputTokens: true,
                supportsVision: true,
                supportsFunctionCalling: true,
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
      const settings: WorkspaceAiSettings | null =
        await ctx.prisma.workspaceAiSettings.findUnique({
          where: { workspaceId: input.workspaceId },
        })
      const credentials =
        settings?.providerCredentials &&
        typeof settings.providerCredentials === "object" &&
        !Array.isArray(settings.providerCredentials)
          ? (settings.providerCredentials as Record<string, Record<string, string>>)
          : {}
      return {
        workspaceId: input.workspaceId,
        defaultModelId: settings?.defaultModelId ?? null,
        systemPromptPageId: settings?.systemPromptPageId ?? null,
        temperature: settings?.temperature ?? null,
        maxOutputTokens: settings?.maxOutputTokens ?? null,
        topP: settings?.topP ?? null,
        providerCredentials: credentials,
        skillPageIds: settings?.skillPageIds ?? [],
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        defaultModelId: z.string().uuid().nullable().optional(),
        systemPromptPageId: z.string().uuid().nullable().optional(),
        temperature: z.number().min(0).max(2).nullable().optional(),
        maxOutputTokens: z.number().int().positive().nullable().optional(),
        topP: z.number().min(0).max(1).nullable().optional(),
        providerCredentials: ProviderKeysSchema.optional(),
        skillPageIds: z.array(z.string().uuid()).optional(),
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
      if (input.systemPromptPageId) {
        const page = await ctx.prisma.page.findFirst({
          where: { id: input.systemPromptPageId, workspaceId: input.workspaceId },
          select: { id: true },
        })
        if (!page) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Страница не найдена в workspace" })
        }
      }
      if (input.skillPageIds && input.skillPageIds.length > 0) {
        const found = await ctx.prisma.page.count({
          where: { id: { in: input.skillPageIds }, workspaceId: input.workspaceId },
        })
        if (found !== input.skillPageIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Часть страниц не найдена в workspace",
          })
        }
      }
      const data: Prisma.WorkspaceAiSettingsCreateInput | Prisma.WorkspaceAiSettingsUpdateInput = {}
      if (input.defaultModelId !== undefined) {
        ;(data as Prisma.WorkspaceAiSettingsUpdateInput).defaultModel = input.defaultModelId
          ? { connect: { id: input.defaultModelId } }
          : { disconnect: true }
      }
      if (input.systemPromptPageId !== undefined) {
        ;(data as Prisma.WorkspaceAiSettingsUpdateInput).systemPromptPage = input.systemPromptPageId
          ? { connect: { id: input.systemPromptPageId } }
          : { disconnect: true }
      }
      if (input.temperature !== undefined) data.temperature = input.temperature
      if (input.maxOutputTokens !== undefined) data.maxOutputTokens = input.maxOutputTokens
      if (input.topP !== undefined) data.topP = input.topP
      if (input.providerCredentials !== undefined) {
        data.providerCredentials = input.providerCredentials as Prisma.InputJsonValue
      }
      if (input.skillPageIds !== undefined) data.skillPageIds = input.skillPageIds

      const createData: Prisma.WorkspaceAiSettingsCreateInput = {
        workspace: { connect: { id: input.workspaceId } },
        ...(data as Omit<Prisma.WorkspaceAiSettingsCreateInput, "workspace">),
      }
      const upserted = await ctx.prisma.workspaceAiSettings.upsert({
        where: { workspaceId: input.workspaceId },
        create: createData,
        update: data as Prisma.WorkspaceAiSettingsUpdateInput,
      })

      const credentials =
        upserted.providerCredentials &&
        typeof upserted.providerCredentials === "object" &&
        !Array.isArray(upserted.providerCredentials)
          ? (upserted.providerCredentials as Record<string, Record<string, string>>)
          : {}
      return {
        workspaceId: upserted.workspaceId,
        defaultModelId: upserted.defaultModelId,
        systemPromptPageId: upserted.systemPromptPageId,
        temperature: upserted.temperature,
        maxOutputTokens: upserted.maxOutputTokens,
        topP: upserted.topP,
        providerCredentials: credentials,
        skillPageIds: upserted.skillPageIds,
      }
    }),

  /** Lightweight page picker for skill selection. */
  listWorkspacePages: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: null,
          archived: false,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 200,
        select: { id: true, title: true, ownership: true },
      })
    }),
})
