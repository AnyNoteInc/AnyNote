import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { Prisma, PrismaClient } from '@repo/db'
import { encryptSecret, decryptSecret, type EncryptedPayload } from '@repo/auth'
import {
  WEBHOOK_EVENT_TYPES,
  generateWebhookSecret,
  generateChallenge,
  sendVerificationChallenge,
} from '@repo/webhooks'

import { router, protectedProcedure } from '../trpc'
import { getWorkspaceFeatures } from '../helpers/plan'

const MAX_SUBSCRIPTIONS_PER_WORKSPACE = 20
const DELIVERIES_PAGE_SIZE = 30
const CHALLENGE_TIMEOUT_MS = Number(process.env.WEBHOOK_CHALLENGE_TIMEOUT_MS ?? 10_000)

const eventsSchema = z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1)

const cursorSchema = z
  .object({
    createdAt: z.union([z.date(), z.string()]).transform((v) => new Date(v)),
    id: z.string().uuid(),
  })
  .optional()

/** The list/detail shape — never `secretEnc`, never `verificationChallenge`. */
const SAFE_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  url: true,
  events: true,
  status: true,
  payloadVersion: true,
  verifiedAt: true,
  consecutiveFailures: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WebhookSubscriptionSelect

type RoleAllowed = 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' | 'GUEST'

async function assertRole(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
  allowed: RoleAllowed[],
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || !allowed.includes(member.role as RoleAllowed)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return member
}

const MANAGERS: RoleAllowed[] = ['OWNER', 'ADMIN']

/** Every webhook procedure: OWNER/ADMIN member + the developer-space plan flag. */
async function assertWebhookAccess(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  await assertRole(ctx, workspaceId, MANAGERS)
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.developerSpaceEnabled) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'DEVELOPER_SPACE_NOT_IN_PLAN' })
  }
}

async function findSubscriptionOrThrow(prisma: PrismaClient, id: string, workspaceId: string) {
  const sub = await prisma.webhookSubscription.findFirst({ where: { id, workspaceId } })
  if (!sub) throw new TRPCError({ code: 'NOT_FOUND' })
  return sub
}

function assertHttpsUrl(url: string): void {
  if (!url.startsWith('https://')) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Только https:// адреса' })
  }
}

function decryptStoredSecret(secretEnc: unknown): string {
  try {
    return decryptSecret(secretEnc as EncryptedPayload)
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Секрет вебхука повреждён или изменён ключ шифрования — смените секрет',
    })
  }
}

/**
 * Synchronous endpoint verification (the MCP validateMcp precedent): success
 * activates the subscription, failure leaves it PENDING with the challenge
 * stored for a later `verify` retry.
 */
async function runChallenge(
  prisma: PrismaClient,
  sub: { id: string; url: string },
  secret: string,
  challenge: string,
): Promise<'ACTIVE' | 'PENDING'> {
  const result = await sendVerificationChallenge({
    url: sub.url,
    secret,
    challenge,
    subscriptionId: sub.id,
    timeoutMs: CHALLENGE_TIMEOUT_MS,
  })
  if (!result.ok) return 'PENDING'
  await prisma.webhookSubscription.update({
    where: { id: sub.id },
    data: {
      status: 'ACTIVE',
      verifiedAt: new Date(),
      verificationChallenge: null,
      consecutiveFailures: 0,
    },
  })
  return 'ACTIVE'
}

export const webhookRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWebhookAccess(ctx, input.workspaceId)
      return ctx.prisma.webhookSubscription.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'asc' },
        select: SAFE_SELECT,
      })
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(100),
        url: z.string().url(),
        events: eventsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWebhookAccess(ctx, input.workspaceId)
      assertHttpsUrl(input.url)
      // Count-then-create race accepted: admin-only surface, worst case +1 over the cap.
      const count = await ctx.prisma.webhookSubscription.count({
        where: { workspaceId: input.workspaceId },
      })
      if (count >= MAX_SUBSCRIPTIONS_PER_WORKSPACE) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Достигнут лимит вебхуков (${MAX_SUBSCRIPTIONS_PER_WORKSPACE}) для пространства`,
        })
      }
      const secret = generateWebhookSecret()
      const challenge = generateChallenge()
      const row = await ctx.prisma.webhookSubscription.create({
        data: {
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
          name: input.name,
          url: input.url,
          events: input.events,
          secretEnc: encryptSecret(secret) as unknown as Prisma.InputJsonValue,
          status: 'PENDING',
          verificationChallenge: challenge,
        },
        select: { id: true, url: true },
      })
      const status = await runChallenge(ctx.prisma, row, secret, challenge)
      // The ONLY time the secret crosses the wire.
      return { id: row.id, status, secret }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(100).optional(),
        url: z.string().url().optional(),
        events: eventsSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWebhookAccess(ctx, input.workspaceId)
      const existing = await findSubscriptionOrThrow(ctx.prisma, input.id, input.workspaceId)
      const urlChanged = input.url !== undefined && input.url !== existing.url
      if (urlChanged) assertHttpsUrl(input.url!)
      const challenge = urlChanged ? generateChallenge() : null
      const row = await ctx.prisma.webhookSubscription.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.events !== undefined ? { events: input.events } : {}),
          // URL change invalidates the old verification entirely.
          ...(urlChanged
            ? {
                url: input.url,
                status: 'PENDING' as const,
                verifiedAt: null,
                verificationChallenge: challenge,
              }
            : {}),
        },
        select: SAFE_SELECT,
      })
      if (urlChanged) {
        const secret = decryptStoredSecret(existing.secretEnc)
        const status = await runChallenge(
          ctx.prisma,
          { id: row.id, url: row.url },
          secret,
          challenge!,
        )
        return { ...row, status }
      }
      return row
    }),

  rotateSecret: protectedProcedure
    .input(z.object({ id: z.string().uuid(), workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertWebhookAccess(ctx, input.workspaceId)
      const existing = await findSubscriptionOrThrow(ctx.prisma, input.id, input.workspaceId)
      const secret = generateWebhookSecret()
      await ctx.prisma.webhookSubscription.update({
        where: { id: existing.id },
        data: { secretEnc: encryptSecret(secret) as unknown as Prisma.InputJsonValue },
      })
      // Returned once; old signatures are invalid immediately.
      return { secret }
    }),

  verify: protectedProcedure
    .input(z.object({ id: z.string().uuid(), workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertWebhookAccess(ctx, input.workspaceId)
      const existing = await findSubscriptionOrThrow(ctx.prisma, input.id, input.workspaceId)
      const secret = decryptStoredSecret(existing.secretEnc)
      const challenge = generateChallenge()
      await ctx.prisma.webhookSubscription.update({
        where: { id: existing.id },
        data: { verificationChallenge: challenge },
      })
      const status = await runChallenge(
        ctx.prisma,
        { id: existing.id, url: existing.url },
        secret,
        challenge,
      )
      return { status: status === 'ACTIVE' ? status : existing.status }
    }),

  setEnabled: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWebhookAccess(ctx, input.workspaceId)
      const existing = await findSubscriptionOrThrow(ctx.prisma, input.id, input.workspaceId)
      if (!input.enabled) {
        const row = await ctx.prisma.webhookSubscription.update({
          where: { id: existing.id },
          data: { status: 'DISABLED' },
          select: { status: true },
        })
        return { status: row.status }
      }
      // Resume (incl. re-enable after auto-disable) requires a verified address.
      if (!existing.verifiedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Сначала подтвердите адрес' })
      }
      const row = await ctx.prisma.webhookSubscription.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', consecutiveFailures: 0 },
        select: { status: true },
      })
      return { status: row.status }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertWebhookAccess(ctx, input.workspaceId)
      const existing = await findSubscriptionOrThrow(ctx.prisma, input.id, input.workspaceId)
      await ctx.prisma.webhookSubscription.delete({ where: { id: existing.id } })
      return { ok: true as const }
    }),

  deliveries: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        subscriptionId: z.string().uuid(),
        cursor: cursorSchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertWebhookAccess(ctx, input.workspaceId)
      // The subscription must belong to THIS workspace — never leak a foreign log.
      await findSubscriptionOrThrow(ctx.prisma, input.subscriptionId, input.workspaceId)
      const items = await ctx.prisma.webhookDelivery.findMany({
        where: {
          subscriptionId: input.subscriptionId,
          ...(input.cursor
            ? {
                OR: [
                  { createdAt: { lt: input.cursor.createdAt } },
                  { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: DELIVERIES_PAGE_SIZE,
        select: {
          id: true,
          eventType: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
          responseStatus: true,
          responseSnippet: true,
          latencyMs: true,
          lastError: true,
          createdAt: true,
        },
      })
      const last = items[items.length - 1]
      const nextCursor =
        items.length === DELIVERIES_PAGE_SIZE && last
          ? { createdAt: last.createdAt, id: last.id }
          : null
      return { items, nextCursor }
    }),
})
