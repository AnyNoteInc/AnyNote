import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { Prisma, PrismaClient } from '@repo/db'
import { encryptSecret, decryptSecret, type EncryptedPayload } from '@repo/auth'
import { WEBHOOK_EVENT_TYPES } from '@repo/webhooks'
import {
  TELEGRAM_LIMITS,
  TelegramApi,
  generateTelegramWebhookSecret,
  generateLinkCode,
  hashLinkCode,
} from '@repo/telegram'

import { router, protectedProcedure } from '../trpc'
import { getWorkspaceFeatures } from '../helpers/plan'
import { assertRole, type WorkspaceRole } from '../helpers/membership'

const LOG_PAGE_SIZE = 30
const TELEGRAM_TIMEOUT_MS = Number(process.env.TELEGRAM_TIMEOUT_MS ?? 10_000)

/** BotFather token shape — rejected by zod BEFORE any encryption or network call. */
const botTokenSchema = z
  .string()
  .max(200)
  .regex(/^\d+:[\w-]{30,}$/, 'Неверный формат токена бота')

const eventsSchema = z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1)

const cursorSchema = z
  .object({
    createdAt: z.union([z.date(), z.string()]).transform((v) => new Date(v)),
    id: z.string().uuid(),
  })
  .optional()

/** Connection read shape — never `botTokenEnc`, never `webhookSecretEnc`. */
const CONNECTION_SAFE_SELECT = {
  id: true,
  workspaceId: true,
  botUsername: true,
  status: true,
  consecutiveFailures: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TelegramConnectionSelect

const CHAT_SELECT = {
  id: true,
  chatId: true,
  type: true,
  title: true,
  status: true,
  createdAt: true,
} satisfies Prisma.TelegramChatSelect

const SUBSCRIPTION_SELECT = {
  id: true,
  chatId: true,
  collectionId: true,
  events: true,
  createdAt: true,
  updatedAt: true,
  chat: { select: { id: true, title: true, type: true, status: true } },
  collection: { select: { id: true, title: true } },
} satisfies Prisma.TelegramCollectionSubscriptionSelect

const MANAGERS: WorkspaceRole[] = ['OWNER', 'ADMIN']

/** Every managed telegram procedure: OWNER/ADMIN member + the developer-space plan flag. */
async function assertTelegramAccess(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  await assertRole(ctx, workspaceId, MANAGERS)
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.developerSpaceEnabled) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'DEVELOPER_SPACE_NOT_IN_PLAN' })
  }
}

async function findConnectionOrThrow(prisma: PrismaClient, workspaceId: string) {
  const connection = await prisma.telegramConnection.findUnique({ where: { workspaceId } })
  if (!connection) throw new TRPCError({ code: 'NOT_FOUND' })
  return connection
}

function decryptStored(payload: unknown): string {
  try {
    return decryptSecret(payload as EncryptedPayload)
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message:
        'Секреты подключения повреждены или изменён ключ шифрования — подключите бота заново',
    })
  }
}

function webhookUrlFor(connectionId: string): string {
  return `${process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'}/api/telegram/webhook/${connectionId}`
}

/** Column is VarChar(500); TelegramApi already keeps the token out of descriptions. */
function truncateError(description: string): string {
  return description.slice(0, 500)
}

function keysetWhere(cursor: { createdAt: Date; id: string } | undefined) {
  return cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }
    : {}
}

function nextCursorFor<T extends { createdAt: Date; id: string }>(items: T[]) {
  const last = items[items.length - 1]
  return items.length === LOG_PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : null
}

/**
 * Synchronous getMe + setWebhook (the 7A challenge precedent, timeout-bounded
 * by TELEGRAM_TIMEOUT_MS): both ok ⇒ ACTIVE, otherwise the connection is saved
 * as ERROR with the sanitized Bot API description only — `TelegramApi` never
 * surfaces the token in any error string.
 */
async function runHandshake(
  prisma: PrismaClient,
  connectionId: string,
  token: string,
  secret: string,
) {
  const api = new TelegramApi(token, { timeoutMs: TELEGRAM_TIMEOUT_MS })
  const me = await api.getMe()
  if (!me.ok) {
    return prisma.telegramConnection.update({
      where: { id: connectionId },
      data: { status: 'ERROR', lastError: truncateError(me.description) },
      select: CONNECTION_SAFE_SELECT,
    })
  }
  const botUsername = me.result.username ?? null
  const hook = await api.setWebhook(webhookUrlFor(connectionId), secret)
  if (!hook.ok) {
    return prisma.telegramConnection.update({
      where: { id: connectionId },
      data: { status: 'ERROR', lastError: truncateError(hook.description), botUsername },
      select: CONNECTION_SAFE_SELECT,
    })
  }
  return prisma.telegramConnection.update({
    where: { id: connectionId },
    data: { status: 'ACTIVE', lastError: null, botUsername, consecutiveFailures: 0 },
    select: CONNECTION_SAFE_SELECT,
  })
}

export const telegramRouter = router({
  getConnection: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const connection = await ctx.prisma.telegramConnection.findUnique({
        where: { workspaceId: input.workspaceId },
        select: CONNECTION_SAFE_SELECT,
      })
      return connection ?? null
    }),

  connect: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), botToken: botTokenSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const secret = generateTelegramWebhookSecret()
      // One connection per workspace: reconnect replaces BOTH secrets and
      // resets the failure state before re-running the handshake.
      const connection = await ctx.prisma.telegramConnection.upsert({
        where: { workspaceId: input.workspaceId },
        update: {
          botTokenEnc: encryptSecret(input.botToken) as unknown as Prisma.InputJsonValue,
          webhookSecretEnc: encryptSecret(secret) as unknown as Prisma.InputJsonValue,
          botUsername: null,
          status: 'PENDING',
          consecutiveFailures: 0,
          lastError: null,
        },
        create: {
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
          botTokenEnc: encryptSecret(input.botToken) as unknown as Prisma.InputJsonValue,
          webhookSecretEnc: encryptSecret(secret) as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      })
      // The token never crosses back over the wire — SAFE_SELECT only.
      return runHandshake(ctx.prisma, connection.id, input.botToken, secret)
    }),

  verify: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const existing = await findConnectionOrThrow(ctx.prisma, input.workspaceId)
      if (existing.status === 'DISABLED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Подключение отключено — подключите бота заново',
        })
      }
      const token = decryptStored(existing.botTokenEnc)
      const secret = decryptStored(existing.webhookSecretEnc)
      return runHandshake(ctx.prisma, existing.id, token, secret)
    }),

  disconnect: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const existing = await findConnectionOrThrow(ctx.prisma, input.workspaceId)
      // Best-effort webhook removal: a dead token or network failure must
      // never block the disconnect itself.
      try {
        const token = decryptSecret(existing.botTokenEnc as EncryptedPayload)
        await new TelegramApi(token, { timeoutMs: TELEGRAM_TIMEOUT_MS }).deleteWebhook()
      } catch {
        // ignore — best-effort
      }
      const [row] = await ctx.prisma.$transaction([
        ctx.prisma.telegramConnection.update({
          where: { id: existing.id },
          data: { status: 'DISABLED' },
          select: CONNECTION_SAFE_SELECT,
        }),
        ctx.prisma.telegramDelivery.updateMany({
          where: { connectionId: existing.id, status: 'PENDING' },
          data: { status: 'SKIPPED' },
        }),
      ])
      return row
    }),

  listChats: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      return ctx.prisma.telegramChat.findMany({
        where: { connection: { workspaceId: input.workspaceId } },
        orderBy: { createdAt: 'asc' },
        select: CHAT_SELECT,
      })
    }),

  removeChat: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), chatId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const chat = await ctx.prisma.telegramChat.findFirst({
        where: { id: input.chatId, connection: { workspaceId: input.workspaceId } },
        select: { id: true },
      })
      if (!chat) throw new TRPCError({ code: 'NOT_FOUND' })
      // Cascade removes the chat's subscriptions.
      await ctx.prisma.telegramChat.delete({ where: { id: chat.id } })
      return { ok: true as const }
    }),

  createSubscription: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        chatId: z.string().uuid(),
        collectionId: z.string().uuid(),
        events: eventsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const connection = await findConnectionOrThrow(ctx.prisma, input.workspaceId)
      const chat = await ctx.prisma.telegramChat.findFirst({
        where: { id: input.chatId, connectionId: connection.id },
        select: { id: true },
      })
      if (!chat) throw new TRPCError({ code: 'NOT_FOUND' })
      const collection = await ctx.prisma.collection.findFirst({
        where: { id: input.collectionId, workspaceId: input.workspaceId },
        select: { id: true, kind: true },
      })
      if (!collection) throw new TRPCError({ code: 'NOT_FOUND' })
      // PERSONAL/SITE collections are never subscribable — TEAM-only at
      // creation is the first half of the no-leak defence (the command-side
      // subscribed-collection filter is the second).
      if (collection.kind !== 'TEAM') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Только командные разделы' })
      }
      const duplicate = await ctx.prisma.telegramCollectionSubscription.findUnique({
        where: { chatId_collectionId: { chatId: chat.id, collectionId: collection.id } },
        select: { id: true },
      })
      if (duplicate) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Этот чат уже подписан на раздел' })
      }
      // Count-then-create race accepted: admin-only surface, worst case +1
      // over the cap (the 7A precedent).
      const count = await ctx.prisma.telegramCollectionSubscription.count({
        where: { connectionId: connection.id },
      })
      if (count >= TELEGRAM_LIMITS.maxSubscriptionsPerConnection) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Достигнут лимит подписок (${TELEGRAM_LIMITS.maxSubscriptionsPerConnection}) для подключения`,
        })
      }
      return ctx.prisma.telegramCollectionSubscription.create({
        data: {
          connectionId: connection.id,
          chatId: chat.id,
          collectionId: collection.id,
          events: input.events,
          createdById: ctx.user.id,
        },
        select: SUBSCRIPTION_SELECT,
      })
    }),

  updateSubscription: protectedProcedure
    .input(
      z.object({ workspaceId: z.string().uuid(), id: z.string().uuid(), events: eventsSchema }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const sub = await ctx.prisma.telegramCollectionSubscription.findFirst({
        where: { id: input.id, connection: { workspaceId: input.workspaceId } },
        select: { id: true },
      })
      if (!sub) throw new TRPCError({ code: 'NOT_FOUND' })
      return ctx.prisma.telegramCollectionSubscription.update({
        where: { id: sub.id },
        data: { events: input.events },
        select: SUBSCRIPTION_SELECT,
      })
    }),

  deleteSubscription: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const sub = await ctx.prisma.telegramCollectionSubscription.findFirst({
        where: { id: input.id, connection: { workspaceId: input.workspaceId } },
        select: { id: true },
      })
      if (!sub) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.prisma.telegramCollectionSubscription.delete({ where: { id: sub.id } })
      return { ok: true as const }
    }),

  listSubscriptions: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      return ctx.prisma.telegramCollectionSubscription.findMany({
        where: { connection: { workspaceId: input.workspaceId } },
        orderBy: { createdAt: 'asc' },
        select: SUBSCRIPTION_SELECT,
      })
    }),

  deliveries: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), cursor: cursorSchema }))
    .query(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      // The connection must belong to THIS workspace — never leak a foreign log.
      const connection = await findConnectionOrThrow(ctx.prisma, input.workspaceId)
      const items = await ctx.prisma.telegramDelivery.findMany({
        where: { connectionId: connection.id, ...keysetWhere(input.cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LOG_PAGE_SIZE,
        // No payload — the stored envelope never reaches the browser.
        select: {
          id: true,
          subscriptionId: true,
          eventType: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
          responseSnippet: true,
          lastError: true,
          createdAt: true,
        },
      })
      return { items, nextCursor: nextCursorFor(items) }
    }),

  auditLog: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), cursor: cursorSchema }))
    .query(async ({ ctx, input }) => {
      await assertTelegramAccess(ctx, input.workspaceId)
      const connection = await findConnectionOrThrow(ctx.prisma, input.workspaceId)
      const items = await ctx.prisma.telegramBotCommandAudit.findMany({
        where: { connectionId: connection.id, ...keysetWhere(input.cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LOG_PAGE_SIZE,
        select: {
          id: true,
          chatId: true,
          telegramUserId: true,
          linkedUserId: true,
          command: true,
          argsSummary: true,
          result: true,
          detail: true,
          createdAt: true,
        },
      })
      return { items, nextCursor: nextCursorFor(items) }
    }),

  // ── Member-level (any authenticated user; no role or plan gate) ───────────

  createLinkCode: protectedProcedure.mutation(async ({ ctx }) => {
    // Single active code per user: prior unused codes die the moment a new
    // one is issued (marked used, not deleted — the trail stays).
    await ctx.prisma.telegramLinkCode.updateMany({
      where: { userId: ctx.user.id, usedAt: null },
      data: { usedAt: new Date() },
    })
    const code = generateLinkCode()
    const row = await ctx.prisma.telegramLinkCode.create({
      data: {
        userId: ctx.user.id,
        codeHash: hashLinkCode(code),
        expiresAt: new Date(Date.now() + TELEGRAM_LIMITS.linkCodeTtlMs),
      },
      select: { expiresAt: true },
    })
    // The ONLY time the plaintext code crosses the wire.
    return { code, expiresAt: row.expiresAt }
  }),

  getMyLink: protectedProcedure.query(async ({ ctx }) => {
    const link = await ctx.prisma.telegramUserLink.findUnique({
      where: { userId: ctx.user.id },
      select: { username: true, linkedAt: true },
    })
    return link ?? null
  }),

  unlinkMe: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.telegramUserLink.deleteMany({ where: { userId: ctx.user.id } })
    return { ok: true as const }
  }),
})
