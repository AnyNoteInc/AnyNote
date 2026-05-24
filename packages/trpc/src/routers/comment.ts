import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { notify } from '@repo/notifications'

import { router, publicProcedure } from '../trpc'
import { resolveCommentContext, canWriteComment } from '../helpers/comment-access'
import { pageCommentBus } from '../realtime/page-comment-bus'

const ContentSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  mentions: z.array(z.string().uuid()).default([]),
})
const Target = {
  pageId: z.string().uuid().optional(),
  shareId: z.string().optional(),
  anonId: z.string().max(64).optional(),
}

const threadInclude = {
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      authorId: true,
      authorName: true,
      content: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const

type CommentPrisma = Parameters<typeof resolveCommentContext>[0]['prisma']

async function notifyNewComment(
  prisma: CommentPrisma,
  args: {
    threadId: string
    commentId: string
    pageId: string
    workspaceId: string
    actor: { userId?: string; name: string }
    text: string
    mentions: string[]
  },
): Promise<void> {
  const thread = await prisma.pageCommentThread.findUnique({
    where: { id: args.threadId },
    select: {
      page: { select: { createdById: true } },
      comments: { select: { authorId: true } },
    },
  })
  const recipients = new Set<string>()
  if (thread?.page.createdById) recipients.add(thread.page.createdById)
  for (const c of thread?.comments ?? []) if (c.authorId) recipients.add(c.authorId)
  if (args.actor.userId) recipients.delete(args.actor.userId)
  const mentioned = new Set(args.mentions)
  const snippet = args.text.slice(0, 140)
  for (const userId of recipients) {
    if (mentioned.has(userId)) continue // a PAGE_MENTION will cover them
    await notify.commentCreated(prisma as never, {
      userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      commentId: args.commentId,
      actorId: args.actor.userId,
      actorName: args.actor.name,
      snippet,
    })
  }
  for (const userId of mentioned) {
    if (userId === args.actor.userId) continue
    await notify.pageMention(prisma as never, {
      userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      actorId: args.actor.userId,
      actorName: args.actor.name,
      snippet,
    })
  }
}

export const commentRouter = router({
  listThreads: publicProcedure.input(z.object({ ...Target })).query(async ({ ctx, input }) => {
    const c = await resolveCommentContext(ctx, input)
    if (!c.role) throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' })
    return ctx.prisma.pageCommentThread.findMany({
      where: { pageId: c.pageId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        anchorStart: true,
        anchorEnd: true,
        quotedText: true,
        resolvedAt: true,
        createdById: true,
        ...threadInclude,
      },
    })
  }),

  createThread: publicProcedure
    .input(
      z.object({
        ...Target,
        anchorStart: z.string(),
        anchorEnd: z.string(),
        quotedText: z.string().max(2000),
        content: ContentSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const thread = await ctx.prisma.$transaction(async (tx) => {
        const t = await tx.pageCommentThread.create({
          data: {
            pageId: c.pageId,
            anchorStart: input.anchorStart,
            anchorEnd: input.anchorEnd,
            quotedText: input.quotedText,
            createdById: c.author.userId ?? null,
          },
          select: { id: true },
        })
        await tx.pageComment.create({
          data: {
            threadId: t.id,
            authorId: c.author.userId ?? null,
            authorName: c.author.name,
            authorAnonId: c.author.anonId ?? null,
            content: input.content,
          },
          select: { id: true },
        })
        return t
      })
      const firstComment = await ctx.prisma.pageComment.findFirst({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      await notifyNewComment(ctx.prisma, {
        threadId: thread.id,
        commentId: firstComment?.id ?? thread.id,
        pageId: c.pageId,
        workspaceId: c.workspaceId,
        actor: c.author,
        text: input.content.text,
        mentions: input.content.mentions,
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: thread.id })
      return ctx.prisma.pageCommentThread.findUnique({
        where: { id: thread.id },
        select: {
          id: true,
          anchorStart: true,
          anchorEnd: true,
          quotedText: true,
          resolvedAt: true,
          createdById: true,
          ...threadInclude,
        },
      })
    }),

  addComment: publicProcedure
    .input(z.object({ ...Target, threadId: z.string().uuid(), content: ContentSchema }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const thread = await ctx.prisma.pageCommentThread.findUnique({
        where: { id: input.threadId },
        select: { pageId: true },
      })
      if (!thread || thread.pageId !== c.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Тред не найден' })
      }
      const comment = await ctx.prisma.pageComment.create({
        data: {
          threadId: input.threadId,
          authorId: c.author.userId ?? null,
          authorName: c.author.name,
          authorAnonId: c.author.anonId ?? null,
          content: input.content,
        },
        select: { id: true },
      })
      await notifyNewComment(ctx.prisma, {
        threadId: input.threadId,
        commentId: comment.id,
        pageId: c.pageId,
        workspaceId: c.workspaceId,
        actor: c.author,
        text: input.content.text,
        mentions: input.content.mentions,
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: input.threadId })
      return comment
    }),

  editComment: publicProcedure
    .input(z.object({ ...Target, commentId: z.string().uuid(), content: ContentSchema }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const existing = await ctx.prisma.pageComment.findUnique({
        where: { id: input.commentId },
        select: { authorId: true, authorAnonId: true, thread: { select: { pageId: true } } },
      })
      if (!existing || existing.thread.pageId !== c.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Комментарий не найден' })
      }
      const isAuthor =
        (!!c.author.userId && existing.authorId === c.author.userId) ||
        (!!c.author.anonId && existing.authorAnonId === c.author.anonId)
      if (!isAuthor) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Можно редактировать только свои комментарии' })
      }
      return ctx.prisma.pageComment.update({
        where: { id: input.commentId },
        data: { content: input.content },
        select: { id: true },
      })
    }),

  deleteComment: publicProcedure
    .input(z.object({ ...Target, commentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const existing = await ctx.prisma.pageComment.findUnique({
        where: { id: input.commentId },
        select: { authorId: true, authorAnonId: true, threadId: true, thread: { select: { pageId: true } } },
      })
      if (!existing || existing.thread.pageId !== c.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Комментарий не найден' })
      }
      const isAuthor =
        (!!c.author.userId && existing.authorId === c.author.userId) ||
        (!!c.author.anonId && existing.authorAnonId === c.author.anonId)
      const canModerate =
        c.role === 'OWNER' ||
        c.role === 'EDITOR' ||
        (!!c.author.userId && c.author.userId === c.page.createdById)
      if (!isAuthor && !canModerate) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на удаление' })
      }
      await ctx.prisma.pageComment.update({
        where: { id: input.commentId },
        data: { deletedAt: new Date() },
      })
      const remaining = await ctx.prisma.pageComment.count({
        where: { threadId: existing.threadId, deletedAt: null },
      })
      if (remaining === 0) {
        await ctx.prisma.pageCommentThread.update({
          where: { id: existing.threadId },
          data: { resolvedAt: new Date() },
        })
        pageCommentBus.emit(c.pageId, { kind: 'thread.deleted', threadId: existing.threadId })
      } else {
        pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: existing.threadId })
      }
      return { ok: true as const }
    }),

  resolveThread: publicProcedure
    .input(z.object({ ...Target, threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const thread = await ctx.prisma.pageCommentThread.findUnique({
        where: { id: input.threadId },
        select: { pageId: true },
      })
      if (!thread || thread.pageId !== c.pageId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Тред не найден' })
      const updated = await ctx.prisma.pageCommentThread.update({
        where: { id: input.threadId },
        data: { resolvedAt: new Date(), resolvedById: c.author.userId ?? null },
        select: { id: true, resolvedAt: true },
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: input.threadId })
      return updated
    }),

  reopenThread: publicProcedure
    .input(z.object({ ...Target, threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const thread = await ctx.prisma.pageCommentThread.findUnique({
        where: { id: input.threadId },
        select: { pageId: true },
      })
      if (!thread || thread.pageId !== c.pageId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Тред не найден' })
      const updated = await ctx.prisma.pageCommentThread.update({
        where: { id: input.threadId },
        data: { resolvedAt: null, resolvedById: null },
        select: { id: true, resolvedAt: true },
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: input.threadId })
      return updated
    }),
})
