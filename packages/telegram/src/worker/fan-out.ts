import { Prisma, type PrismaClient } from '@repo/db'
import { buildWebhookPayload } from '@repo/webhooks'
import { eventIdForOutboxRow, passesVisibilityGate, sanitizeHints } from '@repo/webhooks/worker'

export type TelegramFanOutOpts = { workerId: string; batchSize: number }

/** Mirrors the webhook fan-out's outbox retry policy (7A markFailedOrRetry). */
const OUTBOX_MAX_ATTEMPTS = 5

type OutboxRow = {
  id: bigint
  event_type: string
  aggregate_id: string
  workspace_id: string | null
  payload: unknown
  created_at: Date
}

/** Shape written by `enqueueIntegrationEvents` (@repo/db). Defensive — payload is untyped JSON. */
type TelegramOutboxPayload = {
  resourceType?: 'page' | 'comment'
  actorId?: string | null
  hints?: Record<string, unknown>
}

/**
 * Claims a batch of `telegram_event` outbox rows (the 7A webhook claim pattern;
 * each SKIP LOCKED consumer claims ONLY its own aggregate_type — the webhook
 * and telegram ticks must never steal each other's rows).
 */
async function claimBatch(prisma: PrismaClient, opts: TelegramFanOutOpts): Promise<OutboxRow[]> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
      SELECT id, event_type, aggregate_id, workspace_id, payload, created_at
      FROM outbox_events
      WHERE status = 'PENDING'
        AND next_attempt_at <= now()
        AND aggregate_type = 'telegram_event'
      ORDER BY id
      LIMIT ${opts.batchSize}
      FOR UPDATE SKIP LOCKED
    `)
    if (rows.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE outbox_events
        SET status='PROCESSING', locked_at=now(), locked_by=${opts.workerId}
        WHERE id IN (${Prisma.join(rows.map((r) => r.id))})
      `)
    }
    return rows
  })
}

async function markDone(prisma: PrismaClient, outboxId: bigint): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE outbox_events
    SET status='DONE', processed_at=now(), locked_at=NULL, locked_by=NULL
    WHERE id = ${outboxId}
  `)
}

async function markFailedOrRetry(
  prisma: PrismaClient,
  outboxId: bigint,
  err: Error,
): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE outbox_events
    SET
      attempts = attempts + 1,
      last_error = ${err.message},
      status = CASE WHEN attempts + 1 >= ${OUTBOX_MAX_ATTEMPTS}
                   THEN 'FAILED'::"OutboxEventStatus"
                   ELSE 'PENDING'::"OutboxEventStatus" END,
      next_attempt_at = now() + (LEAST(300, POWER(2, attempts + 1) * 10) * interval '1 second'),
      locked_at = NULL,
      locked_by = NULL
    WHERE id = ${outboxId}
  `)
}

async function processRow(prisma: PrismaClient, row: OutboxRow): Promise<void> {
  // telegram_event rows are always workspace-scoped; an orphan row cannot
  // resolve subscriptions — drop it.
  if (row.workspace_id === null) {
    await markDone(prisma, row.id)
    return
  }

  // `aggregate_id` is the PAGE id for both page and comment resources (comment
  // events carry their page id by design) — the shared no-leak gate applies to
  // the page either way.
  const visible = await passesVisibilityGate(prisma, row.aggregate_id, row.event_type)
  if (!visible) {
    await markDone(prisma, row.id)
    return
  }

  // The gate admits TEAM-or-null collections; telegram subscriptions are
  // per-collection, so a collection-less (workspace-level) page matches none.
  const page = await prisma.page.findUnique({
    where: { id: row.aggregate_id },
    select: { collectionId: true },
  })
  if (!page || page.collectionId === null) {
    await markDone(prisma, row.id)
    return
  }

  const subscriptions = await prisma.telegramCollectionSubscription.findMany({
    where: {
      collectionId: page.collectionId,
      events: { has: row.event_type },
      chat: { status: 'ACTIVE' },
      connection: { status: 'ACTIVE', workspaceId: row.workspace_id },
    },
    select: { id: true, connectionId: true },
  })
  if (subscriptions.length === 0) {
    await markDone(prisma, row.id)
    return
  }

  const p = (row.payload ?? {}) as TelegramOutboxPayload
  // ONE event id per outbox row — deterministic so a redo of the same row
  // (crash before markDone) cannot mint a second id; paired with the
  // (subscriptionId, eventId) unique constraint + skipDuplicates below.
  const eventId = eventIdForOutboxRow(row.id)
  // §6: the STORED payload is the 7A metadata envelope — ids and sanitized
  // hints only, never titles or content.
  const payload = buildWebhookPayload({
    eventId,
    event: row.event_type,
    workspaceId: row.workspace_id,
    actorId: p.actorId ?? null,
    resourceType: p.resourceType ?? 'page',
    resourceId: row.aggregate_id,
    // Hint page-ids pass the same visibility bar as the resource (no-leak).
    hints: await sanitizeHints(prisma, p.hints ?? {}),
    occurredAt: row.created_at,
  })

  await prisma.telegramDelivery.createMany({
    data: subscriptions.map((s) => ({
      connectionId: s.connectionId,
      subscriptionId: s.id,
      eventType: row.event_type,
      eventId,
      payload: payload as Prisma.InputJsonObject,
    })),
    // Redo self-defense: the (subscriptionId, eventId) unique constraint makes
    // a re-fan-out of an already-delivered row a no-op instead of a duplicate.
    skipDuplicates: true,
  })
  await markDone(prisma, row.id)
}

/**
 * Telegram fan-out tick: drains `telegram_event` outbox rows into
 * per-subscription `telegram_deliveries` rows (PENDING — the delivery
 * tick sends them).
 */
export async function runTelegramFanOutTick(
  prisma: PrismaClient,
  opts: TelegramFanOutOpts,
): Promise<void> {
  const rows = await claimBatch(prisma, opts)
  if (rows.length === 0) return
  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await processRow(prisma, row)
      } catch (err) {
        await markFailedOrRetry(prisma, row.id, err instanceof Error ? err : new Error(String(err)))
      }
    }),
  )
}
