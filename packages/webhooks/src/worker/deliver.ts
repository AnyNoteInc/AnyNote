import { decryptSecret, type EncryptedPayload } from '@repo/auth/secret-encryption.ts'
import { Prisma, type PrismaClient } from '@repo/db'

import { signWebhookPayload } from '../signature.ts'
import { assertSafeWebhookUrl, SsrfBlockedError, type LookupFn } from '../ssrf.ts'
import { passesVisibilityGate } from './fan-out.ts'

export type DeliverOpts = {
  workerId: string
  batchSize: number
  maxAttempts: number
  timeoutMs: number
  fetchFn?: typeof fetch
  lookup?: LookupFn
  autoDisableThreshold?: number // default 10
}

const BACKOFF_BASE_MS = 60_000
const BACKOFF_CAP_MS = 30 * 60_000
const DEFAULT_AUTO_DISABLE_THRESHOLD = 10
const SNIPPET_MAX_CHARS = 500

type DeliveryWithSubscription = Prisma.WebhookDeliveryGetPayload<{
  include: { subscription: true }
}>

/** Backoff from the PRE-failure attempt count: 60s, 120s, 240s … cap 30min. */
function nextAttemptAt(prevAttempts: number): Date {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** prevAttempts, BACKOFF_CAP_MS)
  return new Date(Date.now() + delay)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** SKIP-LOCKED claim over webhook_deliveries (the notifications lock pattern). */
async function lockPendingDeliveries(
  prisma: PrismaClient,
  args: { workerId: string; batchSize: number },
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM webhook_deliveries
      WHERE status = 'PENDING'
        AND next_attempt_at <= now()
        AND locked_at IS NULL
      ORDER BY next_attempt_at
      LIMIT ${args.batchSize}
      FOR UPDATE SKIP LOCKED
    `)
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    await tx.webhookDelivery.updateMany({
      where: { id: { in: ids } },
      data: { lockedAt: new Date(), lockedBy: args.workerId },
    })
    return ids
  })
}

/** Terminal failure that bypasses the retry ladder (gate/config terminals). */
async function failTerminal(
  prisma: PrismaClient,
  deliveryId: string,
  lastError: string,
): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: 'FAILED', lastError, lockedAt: null, lockedBy: null },
  })
}

/**
 * Increments the subscription's consecutiveFailures and auto-disables it at the
 * threshold. The check uses the row RETURNED by the increment update — never a
 * separate read — so concurrent workers cannot lose the threshold crossing.
 */
async function bumpConsecutiveFailures(
  prisma: PrismaClient,
  subscriptionId: string,
  threshold: number,
): Promise<void> {
  const updated = await prisma.webhookSubscription.update({
    where: { id: subscriptionId },
    data: { consecutiveFailures: { increment: 1 } },
    select: { consecutiveFailures: true },
  })
  if (updated.consecutiveFailures >= threshold) {
    await prisma.webhookSubscription.update({
      where: { id: subscriptionId },
      data: { status: 'FAILED' },
    })
  }
}

async function readSnippet(res: Response): Promise<string | null> {
  try {
    const text = await res.text()
    return text.length > 0 ? text.slice(0, SNIPPET_MAX_CHARS) : null
  } catch {
    return null
  }
}

/** Retryable failure: backoff until maxAttempts, then FAILED + counted. */
async function recordFailure(
  prisma: PrismaClient,
  delivery: DeliveryWithSubscription,
  opts: DeliverOpts,
  details: {
    lastError: string
    responseStatus?: number | null
    responseSnippet?: string | null
    latencyMs?: number | null
  },
): Promise<void> {
  const attempts = delivery.attempts + 1
  const isTerminal = attempts >= opts.maxAttempts
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: isTerminal ? 'FAILED' : 'PENDING',
      attempts,
      nextAttemptAt: isTerminal ? delivery.nextAttemptAt : nextAttemptAt(delivery.attempts),
      responseStatus: details.responseStatus ?? null,
      responseSnippet: details.responseSnippet ?? null,
      latencyMs: details.latencyMs ?? null,
      lastError: details.lastError,
      lockedAt: null,
      lockedBy: null,
    },
  })
  if (isTerminal) {
    await bumpConsecutiveFailures(
      prisma,
      delivery.subscriptionId,
      opts.autoDisableThreshold ?? DEFAULT_AUTO_DISABLE_THRESHOLD,
    )
  }
}

async function attemptDelivery(
  prisma: PrismaClient,
  delivery: DeliveryWithSubscription,
  opts: DeliverOpts,
): Promise<void> {
  const sub = delivery.subscription

  // The subscription may have been paused/disabled since fan-out. No counter —
  // nothing was attempted against the endpoint.
  if (sub.status !== 'ACTIVE') {
    await failTerminal(prisma, delivery.id, 'subscription inactive')
    return
  }

  // Send-time visibility re-check (no-leak): the page may have moved to a
  // personal collection or been trashed since the fan-out gated it. The
  // payload's resource id IS the page id (comments included, by design).
  const payload = delivery.payload as { resource?: { id?: unknown } }
  const pageId = payload?.resource?.id
  const visible =
    typeof pageId === 'string' && (await passesVisibilityGate(prisma, pageId, delivery.eventType))
  if (!visible) {
    // Does NOT count toward consecutiveFailures — the endpoint did nothing wrong.
    await failTerminal(prisma, delivery.id, 'resource no longer workspace-visible')
    return
  }

  // SSRF guard, re-resolved at send time. Terminal AND counted — a URL that
  // resolves to a private range is an endpoint problem like any persistent
  // failure, and must drive the subscription toward auto-disable.
  try {
    await assertSafeWebhookUrl(sub.url, opts.lookup)
  } catch (err) {
    const reason = err instanceof SsrfBlockedError ? err.message : errorMessage(err)
    await failTerminal(prisma, delivery.id, `ssrf blocked: ${reason}`)
    await bumpConsecutiveFailures(
      prisma,
      sub.id,
      opts.autoDisableThreshold ?? DEFAULT_AUTO_DISABLE_THRESHOLD,
    )
    return
  }

  const secret = decryptSecret(sub.secretEnc as unknown as EncryptedPayload)
  const body = JSON.stringify(delivery.payload)
  const timestampSec = Math.floor(Date.now() / 1000)
  const signature = signWebhookPayload(secret, timestampSec, body)
  const fetchFn = opts.fetchFn ?? fetch

  const startedAt = Date.now()
  let res: Response | undefined
  let transportError: unknown
  try {
    res = await fetchFn(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AnyNote-Signature': signature,
        'X-AnyNote-Timestamp': String(timestampSec),
        'X-AnyNote-Event': delivery.eventType,
        'X-AnyNote-Delivery': delivery.id,
        'X-AnyNote-Payload-Version': String(sub.payloadVersion),
      },
      body,
      // A redirect could point at a private host and evade the SSRF guard —
      // never follow; any 3xx response is treated as a plain failure below.
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (err) {
    transportError = err
  }
  const latencyMs = Date.now() - startedAt

  if (res && res.status >= 200 && res.status < 300) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'DELIVERED',
        responseStatus: res.status,
        responseSnippet: await readSnippet(res),
        latencyMs,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
      },
    })
    if (sub.consecutiveFailures > 0) {
      await prisma.webhookSubscription.update({
        where: { id: sub.id },
        data: { consecutiveFailures: 0 },
      })
    }
    return
  }

  await recordFailure(prisma, delivery, opts, {
    lastError: res ? `http ${res.status}` : errorMessage(transportError),
    responseStatus: res?.status ?? null,
    responseSnippet: res ? await readSnippet(res) : null,
    latencyMs,
  })
}

/**
 * Delivery tick: claims PENDING webhook_deliveries past their nextAttemptAt and
 * POSTs each one, HMAC-signed, to its subscription URL. Every outcome —
 * success, retry, terminal — clears the lock.
 */
export async function runDeliveryTick(prisma: PrismaClient, opts: DeliverOpts): Promise<void> {
  const ids = await lockPendingDeliveries(prisma, {
    workerId: opts.workerId,
    batchSize: opts.batchSize,
  })
  if (ids.length === 0) return

  await Promise.allSettled(
    ids.map(async (id) => {
      const delivery = await prisma.webhookDelivery.findUnique({
        where: { id },
        include: { subscription: true },
      })
      if (!delivery) return
      try {
        await attemptDelivery(prisma, delivery, opts)
      } catch (err) {
        // Unexpected error (decrypt/DB mid-flight) — schedule through the same
        // retry ladder so the row is never left locked.
        await recordFailure(prisma, delivery, opts, { lastError: errorMessage(err) })
      }
    }),
  )
}
