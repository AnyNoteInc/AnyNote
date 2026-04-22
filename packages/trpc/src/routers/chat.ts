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
  const chat = await ctx.prisma.chat.findFirst({
    where: {
      id: chatId,
      workspace: { members: { some: { userId: ctx.user.id } } },
    },
  })
  if (!chat) throw new TRPCError({ code: "NOT_FOUND" })
  return chat
}

type ChatMessageWithFiles = {
  id: string
  role: "USER" | "ASSISTANT"
  status: "STREAMING" | "DONE" | "ERROR"
  errorMessage: string | null
  content: string
  createdAt: Date
  updatedAt: Date
  files: Array<{
    file: {
      id: string
      name: string
      mimeType: string
      fileSize: bigint
    }
  }>
}

function normalizeChatMessage(message: ChatMessageWithFiles) {
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    errorMessage: message.errorMessage,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    parts: [
      ...(message.content.trim().length > 0
        ? [{ type: "text" as const, text: message.content }]
        : []),
      ...message.files.map(({ file }) => ({
        type: "file" as const,
        fileId: file.id,
        name: file.name,
        mimeType: file.mimeType,
        fileSize: file.fileSize.toString(),
        downloadUrl: `/api/files/${file.id}`,
      })),
    ],
  }
}

export const chatRouter = router({
  listChats: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.chat.findMany({
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
      const messages = (await ctx.prisma.chatMessage.findMany({
        include: {
          files: {
            include: { file: true },
            orderBy: { createdAt: "asc" },
          },
        },
        where: { chatId: chat.id },
        orderBy: { createdAt: "asc" },
      })) as ChatMessageWithFiles[]
      return {
        chat,
        messages: messages.map(normalizeChatMessage),
      }
    }),

  createChat: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), parentId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      if (input.parentId) {
        await assertChatAccess(ctx, input.parentId)
      }
      return ctx.prisma.chat.create({
        data: {
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
          parentId: input.parentId ?? null,
        },
      })
    }),

  renameChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid(), title: z.string().min(1).max(48) }))
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId)
      return ctx.prisma.chat.update({
        where: { id: input.chatId },
        data: { title: input.title },
      })
    }),

  deleteChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId)
      await ctx.prisma.chat.delete({ where: { id: input.chatId } })
      return { ok: true }
    }),
})
