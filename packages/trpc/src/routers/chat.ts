import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import type { PrismaClient } from '@repo/db'

import { router, protectedProcedure } from '../trpc'

async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) throw new TRPCError({ code: 'FORBIDDEN' })
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
  if (!chat) throw new TRPCError({ code: 'NOT_FOUND' })
  return chat
}

type ChatMessageWithParts = {
  id: string
  role: 'USER' | 'ASSISTANT'
  status: 'STREAMING' | 'DONE' | 'ERROR'
  errorMessage: string | null
  parts: unknown
  createdAt: Date
  updatedAt: Date
}

type ChatToolPartState = 'pending' | 'running' | 'done' | 'error' | 'required'

type ChatMessagePartDto =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool'
      id: string
      kind: 'tool' | 'confirmation'
      state: ChatToolPartState
      title: string
      detail?: string
      result?: string
    }
  | {
      type: 'attacment'
      fileId: string
      name: string
      mimeType: string
      fileSize: string
      downloadUrl: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeFileSize(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function normalizeToolState(value: unknown): ChatToolPartState | null {
  return value === 'pending' ||
    value === 'running' ||
    value === 'done' ||
    value === 'error' ||
    value === 'required'
    ? value
    : null
}

function normalizeTextLikePart(
  type: 'text' | 'thinking',
  part: Record<string, unknown>,
): ChatMessagePartDto[] {
  const text = requiredString(part.text)
  return text ? [{ type, text }] : []
}

function normalizeMessageParts(parts: unknown): ChatMessagePartDto[] {
  if (!Array.isArray(parts)) {
    return []
  }

  return parts.flatMap<ChatMessagePartDto>((part) => {
    if (!isRecord(part)) {
      return []
    }

    if (part.type === 'text' || part.type === 'thinking') {
      return normalizeTextLikePart(part.type, part)
    }

    if (part.type === 'tool') {
      const id = requiredString(part.id)
      const title = requiredString(part.title)
      const kind =
        part.kind === 'confirmation' ? 'confirmation' : part.kind === 'tool' ? 'tool' : null
      const state = normalizeToolState(part.state)

      if (!id || !title || !kind || !state) {
        return []
      }

      const detail = optionalString(part.detail)
      const result = optionalString(part.result)

      return [
        {
          type: 'tool' as const,
          id,
          kind,
          state,
          title,
          ...(detail ? { detail } : {}),
          ...(result ? { result } : {}),
        },
      ]
    }

    if (part.type === 'attacment') {
      const fileId = requiredString(part.fileId)
      const name = requiredString(part.name)
      const mimeType = requiredString(part.mimeType)
      const fileSize = normalizeFileSize(part.fileSize)

      if (!fileId || !name || !mimeType || !fileSize) {
        return []
      }

      return [
        {
          type: 'attacment' as const,
          fileId,
          name,
          mimeType,
          fileSize,
          downloadUrl: `/api/files/${fileId}`,
        },
      ]
    }

    return []
  })
}

function normalizeChatMessage(message: ChatMessageWithParts) {
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    errorMessage: message.errorMessage,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    parts: normalizeMessageParts(message.parts),
  }
}

export const chatRouter = router({
  listChats: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.chat.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { updatedAt: 'desc' },
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
        where: { chatId: chat.id },
        orderBy: { createdAt: 'asc' },
      })) as ChatMessageWithParts[]
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

  addFavorite: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId)
      return ctx.prisma.favoriteChat.upsert({
        where: { userId_chatId: { userId: ctx.user.id, chatId: input.chatId } },
        create: { userId: ctx.user.id, chatId: input.chatId },
        update: {},
      })
    }),

  removeFavorite: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId)
      await ctx.prisma.favoriteChat.deleteMany({
        where: { userId: ctx.user.id, chatId: input.chatId },
      })
      return { chatId: input.chatId }
    }),

  listFavorites: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const favorites = await ctx.prisma.favoriteChat.findMany({
        where: {
          userId: ctx.user.id,
          chat: { workspaceId: input.workspaceId },
        },
        include: {
          chat: {
            select: {
              id: true,
              title: true,
              parentId: true,
              updatedAt: true,
              createdAt: true,
              createdById: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      return favorites.map((f) => f.chat)
    }),
})
