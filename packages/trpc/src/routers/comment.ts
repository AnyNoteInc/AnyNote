import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  notify,
  notifyPageActivity,
  resolvePageActivityRecipients,
} from '@repo/notifications'
import type { PrismaClient } from '@repo/db'

import { router, publicProcedure } from '../trpc'
import { resolveCommentContext, canWriteComment } from '../helpers/comment-access'
import { pageCommentBus, type PageCommentEvent } from '../realtime/page-comment-bus'

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
type ResolvedCommentContext = Awaited<ReturnType<typeof resolveCommentContext>>

function requireAnonymousAuthorIdentity(c: ResolvedCommentContext): void {
  if (!c.author.userId && !c.author.anonId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing anonymous identity' })
  }
}

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
    // True when this comment was added to an EXISTING thread (a reply); false
    // for the first comment that opens a new thread.
    isReply: boolean
  },
): Promise<void> {
  // Notifications are a side effect: a failure here must never fail the write.
  try {
    const thread = await prisma.pageCommentThread.findUnique({
      where: { id: args.threadId },
      select: {
        page: { select: { createdById: true } },
        comments: { select: { authorId: true } },
      },
    })
    // Thread participants: the page author + every prior comment author, minus
    // the actor. On a reply these are notified directly (COMMENT_REPLY); on a
    // first comment they get the classic COMMENT_CREATED.
    const participants = new Set<string>()
    if (thread?.page.createdById) participants.add(thread.page.createdById)
    for (const c of thread?.comments ?? []) if (c.authorId) participants.add(c.authorId)
    if (args.actor.userId) participants.delete(args.actor.userId)

    // Validate mentions against workspace membership: prevents notifying (and
    // leaking the snippet/link to) arbitrary users by id (spec §6).
    const validMentions = args.mentions.length
      ? await prisma.workspaceMember.findMany({
          where: { workspaceId: args.workspaceId, userId: { in: args.mentions } },
          select: { userId: true },
        })
      : []
    const mentioned = new Set(validMentions.map((m) => m.userId))
    const snippet = args.text.slice(0, 140)

    // Mentions are notified directly and bypass dedup; they also pre-empt every
    // other channel for that user (a single, most-specific notification).
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

    // Direct participant fan-out: a reply → COMMENT_REPLY (bypasses dedup); a
    // first comment → COMMENT_CREATED. Skip anyone already covered by a mention.
    const directParticipants = [...participants].filter((u) => !mentioned.has(u))
    if (args.isReply) {
      await notifyPageActivity(prisma as PrismaClient, {
        kind: 'comment_reply',
        recipients: directParticipants,
        payload: {
          workspaceId: args.workspaceId,
          pageId: args.pageId,
          threadId: args.threadId,
          commentId: args.commentId,
          actorId: args.actor.userId,
          actorName: args.actor.name,
          snippet,
        },
      })
    } else {
      for (const userId of directParticipants) {
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
    }

    // "Notify me" pref-driven fan-out: users who opted into ALL_COMMENTS /
    // ALL_UPDATES on this page get a COMMENT_CREATED for ANY new comment, even
    // if they aren't thread participants. Exclude the actor, mentioned users
    // (covered by PAGE_MENTION), and direct participants (already notified).
    const prefRecipients = (
      await resolvePageActivityRecipients(prisma as PrismaClient, {
        pageId: args.pageId,
        kind: 'comment',
        actorId: args.actor.userId,
      })
    ).filter((u) => !mentioned.has(u) && !participants.has(u))
    await notifyPageActivity(prisma as PrismaClient, {
      kind: 'comment',
      recipients: prefRecipients,
      payload: {
        workspaceId: args.workspaceId,
        pageId: args.pageId,
        commentId: args.commentId,
        actorId: args.actor.userId,
        actorName: args.actor.name,
        snippet,
      },
    })
  } catch (err) {
    console.error('[comment] notification fan-out failed', err)
  }
}

export const commentRouter = router({
  events: router({
    subscribe: publicProcedure
      .input(z.object({ pageId: z.string().uuid() }))
      .subscription(async function* ({ ctx, input, signal }) {
        if (!ctx.user) throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' })
        const page = await ctx.prisma.page.findUnique({
          where: { id: input.pageId },
          select: { workspaceId: true },
        })
        if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
        const member = await ctx.prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
          select: { userId: true },
        })
        if (!member) throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' })

        const MAX_QUEUE = 500
        const queue: PageCommentEvent[] = []
        let resolveNext: ((value: PageCommentEvent | null) => void) | null = null

        const unsubscribe = pageCommentBus.on(input.pageId, (event) => {
          if (resolveNext) {
            const r = resolveNext
            resolveNext = null
            r(event)
          } else {
            queue.push(event)
            if (queue.length > MAX_QUEUE) queue.shift()
          }
        })

        const onAbort = () => {
          if (resolveNext) {
            const r = resolveNext
            resolveNext = null
            r(null)
          }
        }
        signal?.addEventListener('abort', onAbort)

        try {
          while (!signal?.aborted) {
            const buffered = queue.shift()
            if (buffered) {
              yield buffered
              continue
            }
            const event = await new Promise<PageCommentEvent | null>((resolve) => {
              resolveNext = resolve
            })
            if (event === null || signal?.aborted) break
            yield event
          }
        } finally {
          unsubscribe()
          signal?.removeEventListener('abort', onAbort)
        }
      }),
  }),

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
      requireAnonymousAuthorIdentity(c)
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
        isReply: false,
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
      requireAnonymousAuthorIdentity(c)
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
        isReply: true,
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: input.threadId })
      return comment
    }),

  editComment: publicProcedure
    .input(z.object({ ...Target, commentId: z.string().uuid(), content: ContentSchema }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      requireAnonymousAuthorIdentity(c)
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
      if (!isAuthor) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Можно редактировать только свои комментарии' })
      }
      const updated = await ctx.prisma.pageComment.update({
        where: { id: input.commentId },
        data: { content: input.content },
        select: { id: true },
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: existing.threadId })
      return updated
    }),

  deleteComment: publicProcedure
    .input(z.object({ ...Target, commentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      requireAnonymousAuthorIdentity(c)
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
      // Moderation (deleting someone else's comment) requires an authenticated
      // identity: a public EDITOR link must not let an anonymous visitor delete
      // others' comments (they can still delete their own via authorAnonId).
      const canModerate =
        !!c.author.userId &&
        (c.role === 'OWNER' || c.role === 'EDITOR' || c.author.userId === c.page.createdById)
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
      requireAnonymousAuthorIdentity(c)
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
      requireAnonymousAuthorIdentity(c)
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
