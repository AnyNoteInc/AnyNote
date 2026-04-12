import { z } from "zod"
import { TRPCError } from "@trpc/server"

import type { PrismaClient } from "@repo/db"

import { router, protectedProcedure } from "../trpc"

async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) throw new TRPCError({ code: "FORBIDDEN" })
}

async function assertChatAccess(
  ctx: { prisma: PrismaClient; user: { id: string } },
  chatId: string,
) {
  const chat = await ctx.prisma.searchChat.findFirst({
    where: {
      id: chatId,
      workspace: { members: { some: { userId: ctx.user.id } } },
    },
  })
  if (!chat) throw new TRPCError({ code: "NOT_FOUND" })
  return chat
}

export const searchRouter = router({
  listChats: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.searchChat.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          parentId: true,
          updatedAt: true,
          createdAt: true,
          createdById: true,
        },
      })
    }),

  getChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const chat = await assertChatAccess(ctx, input.chatId)
      const messages = await ctx.prisma.searchMessage.findMany({
        where: { chatId: chat.id },
        orderBy: { createdAt: "asc" },
      })
      return { chat, messages }
    }),

  createChat: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), parentId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      if (input.parentId) {
        await assertChatAccess(ctx, input.parentId)
      }
      return ctx.prisma.searchChat.create({
        data: {
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
          parentId: input.parentId ?? null,
        },
      })
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        chatId: z.string().uuid(),
        content: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const chat = await assertChatAccess(ctx, input.chatId)
      return ctx.prisma.$transaction(async (tx) => {
        const userMessage = await tx.searchMessage.create({
          data: { chatId: chat.id, role: "USER", content: input.content },
        })
        const assistantMessage = await tx.searchMessage.create({
          data: {
            chatId: chat.id,
            role: "ASSISTANT",
            content: `🔎 MVP echo: "${input.content}". Настоящий RAG подключим с OLLAMA + Weaviate.`,
          },
        })
        const shouldRename = chat.title === "Новый поиск"
        await tx.searchChat.update({
          where: { id: chat.id },
          data: {
            updatedAt: new Date(),
            title: shouldRename ? input.content.slice(0, 48) : undefined,
          },
        })
        return { userMessage, assistantMessage }
      })
    }),

  renameChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid(), title: z.string().min(1).max(48) }))
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId)
      return ctx.prisma.searchChat.update({
        where: { id: input.chatId },
        data: { title: input.title },
      })
    }),

  deleteChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId)
      await ctx.prisma.searchChat.delete({ where: { id: input.chatId } })
      return { ok: true }
    }),
})
