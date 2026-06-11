import { decryptSecret, type EncryptedPayload } from '@repo/auth/secret-encryption.ts'
import { Prisma, type PrismaClient } from '@repo/db'
import { passesVisibilityGate } from '@repo/webhooks/worker'

import { renderEventMessage } from '../render.ts'
import { TelegramApi } from '../api.ts'

import type { WebhookEventType } from '@repo/webhooks'

export type TelegramDeliverOpts = {
  workerId: string
  batchSize: number
  maxAttempts: number
  timeoutMs: number
  fetchFn?: typeof fetch
  autoDisableThreshold?: number // default 10
}

const BACKOFF_BASE_MS = 60_000
const BACKOFF_CAP_MS = 30 * 60_000
/**
 * Stale-lock reclaim horizon (the 7A webhook deliverer pattern): a worker that
 * crashes between claim and outcome leaves the row PENDING with lockedAt set;
 * after this long the lock is considered dead and the row re-claimable.
 */
const STALE_LOCK_MS = 10 * 60_000
const DEFAULT_AUTO_DISABLE_THRESHOLD = 10
const SNIPPET_MAX_CHARS = 500

/**
 * Bot API errors that mean the CHAT is gone (kicked, blocked, deleted,
 * deactivated) rather than the connection being broken: the chat is marked
 * LEFT and the delivery SKIPPED with no retry and no connection
 * failure-streak bump. Telegram-documented description strings only —
 * deliberately NOT a bare `403`, which false-positives on unrelated text
 * (e.g. "4031 rows"). The exact `HTTP 403` form is what TelegramApi returns
 * for a non-JSON 403 body (proxy/HTML error page).
 */
const CHAT_GONE_RE =
  /forbidden|bot was kicked|bot is not a member|chat not found|user is deactivated/i
const isChatGone = (description: string): boolean =>
  CHAT_GONE_RE.test(description) || /^HTTP 403$/.test(description)

type DeliveryWithRelations = Prisma.TelegramDeliveryGetPayload<{
  include: { subscription: { include: { chat: true } }; connection: true }
}>

/** Backoff from the PRE-failure attempt count: 60s, 120s, 240s … cap 30min. */
function nextAttemptAt(prevAttempts: number): Date {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** prevAttempts, BACKOFF_CAP_MS)
  return new Date(Date.now() + delay)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Mirrors the command router's deep-link builder (commands.ts `pageUrl`). */
function pageUrl(pageId: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/pages/${pageId}`
}

/** SKIP-LOCKED claim over telegram_deliveries (the 7A webhook claim pattern). */
async function lockPendingDeliveries(
  prisma: PrismaClient,
  args: { workerId: string; batchSize: number },
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM telegram_deliveries
      WHERE status = 'PENDING'
        AND next_attempt_at <= now()
        AND (locked_at IS NULL OR locked_at < now() - ${STALE_LOCK_MS} * interval '1 millisecond')
      ORDER BY next_attempt_at
      LIMIT ${args.batchSize}
      FOR UPDATE SKIP LOCKED
    `)
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    await tx.telegramDelivery.updateMany({
      where: { id: { in: ids } },
      data: { lockedAt: new Date(), lockedBy: args.workerId },
    })
    return ids
  })
}

/**
 * Skip without retry: the precondition (active connection/chat, visibility,
 * subscription match) no longer holds. Never counts toward the failure streak —
 * nothing was wrong with the connection.
 */
async function skipDelivery(
  prisma: PrismaClient,
  deliveryId: string,
  reason: string,
): Promise<void> {
  await prisma.telegramDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'SKIPPED',
      lastError: reason.slice(0, SNIPPET_MAX_CHARS),
      lockedAt: null,
      lockedBy: null,
    },
  })
}

/** Terminal failure that bypasses the retry ladder (config terminals). */
async function failTerminal(
  prisma: PrismaClient,
  deliveryId: string,
  lastError: string,
): Promise<void> {
  await prisma.telegramDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'FAILED',
      lastError: lastError.slice(0, SNIPPET_MAX_CHARS),
      lockedAt: null,
      lockedBy: null,
    },
  })
}

/**
 * Increments the connection's consecutiveFailures and auto-disables it at the
 * threshold. The check uses the row RETURNED by the increment update — never a
 * separate read — so concurrent workers cannot lose the threshold crossing.
 * Unlike the per-subscription webhook counter, EVERY failed send attempt bumps:
 * the streak measures connection health (token validity, API reachability) and
 * any success resets it.
 */
async function bumpConsecutiveFailures(
  prisma: PrismaClient,
  connectionId: string,
  threshold: number,
  cause: string,
): Promise<void> {
  const updated = await prisma.telegramConnection.update({
    where: { id: connectionId },
    data: { consecutiveFailures: { increment: 1 } },
    select: { consecutiveFailures: true },
  })
  if (updated.consecutiveFailures >= threshold) {
    // A manual DISABLED set mid-flight must never be overridden by the
    // auto-disable transition. updateMany (not update) so the status guard
    // can filter the row out without a P2025 throw.
    await prisma.telegramConnection.updateMany({
      where: { id: connectionId, status: { not: 'DISABLED' } },
      data: {
        status: 'ERROR',
        // `cause` comes from TelegramApi, which never surfaces the token.
        lastError: `авто-отключение после ${updated.consecutiveFailures} ошибок доставки подряд: ${cause}`.slice(
          0,
          SNIPPET_MAX_CHARS,
        ),
      },
    })
  }
}

/** Retryable failure: backoff until maxAttempts, then FAILED. Always counted. */
async function recordFailure(
  prisma: PrismaClient,
  delivery: DeliveryWithRelations,
  opts: TelegramDeliverOpts,
  details: { lastError: string; responseSnippet?: string | null },
): Promise<void> {
  const attempts = delivery.attempts + 1
  const isTerminal = attempts >= opts.maxAttempts
  await prisma.telegramDelivery.update({
    where: { id: delivery.id },
    data: {
      status: isTerminal ? 'FAILED' : 'PENDING',
      attempts,
      nextAttemptAt: isTerminal ? delivery.nextAttemptAt : nextAttemptAt(delivery.attempts),
      responseSnippet: details.responseSnippet?.slice(0, SNIPPET_MAX_CHARS) ?? null,
      lastError: details.lastError.slice(0, SNIPPET_MAX_CHARS),
      lockedAt: null,
      lockedBy: null,
    },
  })
  await bumpConsecutiveFailures(
    prisma,
    delivery.connectionId,
    opts.autoDisableThreshold ?? DEFAULT_AUTO_DISABLE_THRESHOLD,
    details.lastError,
  )
}

async function attemptDelivery(
  prisma: PrismaClient,
  delivery: DeliveryWithRelations,
  opts: TelegramDeliverOpts,
): Promise<void> {
  const { subscription, connection } = delivery

  // The connection may have been disabled/errored since fan-out. No streak
  // bump — nothing was attempted against the Bot API.
  if (connection.status !== 'ACTIVE') {
    await skipDelivery(prisma, delivery.id, 'connection inactive')
    return
  }

  // A corrupted/undecryptable token is permanent until the admin reconnects.
  // Terminal AND counted — retrying cannot fix it, and it must drive the
  // connection toward auto-disable.
  let token: string
  try {
    token = decryptSecret(connection.botTokenEnc as unknown as EncryptedPayload)
  } catch (err) {
    await failTerminal(prisma, delivery.id, `decrypt failed: ${errorMessage(err)}`)
    await bumpConsecutiveFailures(
      prisma,
      delivery.connectionId,
      opts.autoDisableThreshold ?? DEFAULT_AUTO_DISABLE_THRESHOLD,
      'decrypt failed',
    )
    return
  }

  // Send-time visibility re-check (§6, no-leak): the page may have been
  // trashed or moved since the fan-out gated it. The shared gate enforces
  // exists + collection TEAM-or-null + not-trashed (page.deleted excepted) +
  // not a database item-page; the equality check then pins the page to the
  // SUBSCRIBED collection (non-null, hence kind TEAM). The stored payload has
  // no title — only after this bar passes is the title fetched.
  const payload = delivery.payload as { resource?: { id?: unknown }; actor?: { id?: unknown } }
  const pageId = payload?.resource?.id
  const visible =
    typeof pageId === 'string' && (await passesVisibilityGate(prisma, pageId, delivery.eventType))
  if (!visible) {
    await skipDelivery(prisma, delivery.id, 'resource no longer workspace-visible')
    return
  }
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { title: true, collectionId: true },
  })
  if (!page || page.collectionId !== subscription.collectionId) {
    await skipDelivery(prisma, delivery.id, 'resource no longer in the subscribed collection')
    return
  }

  const actorId = payload?.actor?.id
  let actorName: string | null = null
  if (typeof actorId === 'string') {
    const actor = await prisma.user.findUnique({
      where: { id: actorId },
      select: { firstName: true },
    })
    actorName = actor?.firstName ?? null
  }

  const text = renderEventMessage({
    eventType: delivery.eventType as WebhookEventType,
    pageTitle: page.title ?? '',
    pageUrl: pageUrl(pageId),
    actorName,
  })

  const api = new TelegramApi(token, { fetchFn: opts.fetchFn, timeoutMs: opts.timeoutMs })
  const res = await api.sendMessage(subscription.chat.chatId, text)

  if (res.ok) {
    await prisma.telegramDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'SENT',
        responseSnippet: JSON.stringify(res.result).slice(0, SNIPPET_MAX_CHARS),
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
    })
    if (connection.consecutiveFailures > 0) {
      await prisma.telegramConnection.update({
        where: { id: connection.id },
        data: { consecutiveFailures: 0 },
      })
    }
    return
  }

  // The bot was kicked / the chat is gone: dead CHAT, healthy connection.
  // Fan-out stops matching LEFT chats, so no further deliveries pile up.
  if (isChatGone(res.description)) {
    await prisma.telegramChat.update({
      where: { id: subscription.chatId },
      data: { status: 'LEFT' },
    })
    await skipDelivery(prisma, delivery.id, res.description)
    return
  }

  // `res.description` comes from TelegramApi, which never surfaces the token
  // (transport errors collapse to `err.name`).
  await recordFailure(prisma, delivery, opts, {
    lastError: res.description,
    responseSnippet: res.description,
  })
}

/**
 * Telegram delivery tick: claims due PENDING telegram_deliveries and sends each
 * one through the connection's bot. Every outcome — sent, skip, retry,
 * terminal — clears the lock.
 */
export async function runTelegramDeliveryTick(
  prisma: PrismaClient,
  opts: TelegramDeliverOpts,
): Promise<void> {
  const ids = await lockPendingDeliveries(prisma, {
    workerId: opts.workerId,
    batchSize: opts.batchSize,
  })
  if (ids.length === 0) return

  await Promise.allSettled(
    ids.map(async (id) => {
      const delivery = await prisma.telegramDelivery.findUnique({
        where: { id },
        include: { subscription: { include: { chat: true } }, connection: true },
      })
      if (!delivery) return
      try {
        await attemptDelivery(prisma, delivery, opts)
      } catch (err) {
        // Unexpected error (DB mid-flight) — schedule through the same retry
        // ladder so the row is never left locked.
        await recordFailure(prisma, delivery, opts, { lastError: errorMessage(err) })
      }
    }),
  )
}
