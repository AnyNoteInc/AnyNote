import { randomUUID } from 'node:crypto'

import { Prisma, type PrismaClient } from '@repo/db'

import { buildWebhookPayload } from '../payload.ts'

export type FanOutOpts = { workerId: string; batchSize: number }

/** Mirrors the indexer's outbox retry policy (vectorization-cron markFailedOrRetry). */
const OUTBOX_MAX_ATTEMPTS = 5

type OutboxRow = {
  id: bigint
  event_type: string
  aggregate_id: string
  workspace_id: string | null
  payload: unknown
  created_at: Date
}

/** Shape written by `enqueueWebhookEvent` (@repo/db). Defensive — payload is untyped JSON. */
type WebhookOutboxPayload = {
  resourceType?: 'page' | 'comment'
  actorId?: string | null
  hints?: Record<string, unknown>
}

/**
 * The TEAM-visibility no-leak gate. `pageId` is the outbox `aggregate_id` —
 * comment events carry their PAGE id as the resource id by design, so comments
 * gate on the page too. Pass iff:
 *  - the page still exists (a hard-deleted page can no longer prove TEAM
 *    visibility — drop it; the preceding soft delete already emitted
 *    `page.deleted` for the page while it was loadable),
 *  - its collection is TEAM (or it has no collection, e.g. workspace-level pages),
 *  - its parent (if any) is not a DATABASE page (item-page defense-in-depth),
 *  - it is not trashed — except for the `page.deleted` event itself.
 */
export async function passesVisibilityGate(
  prisma: PrismaClient,
  pageId: string,
  eventType: string,
): Promise<boolean> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      deletedAt: true,
      collectionId: true,
      collection: { select: { kind: true } },
      parent: { select: { type: true } },
    },
  })
  if (!page) return false
  if (page.collectionId !== null && page.collection?.kind !== 'TEAM') return false
  if (page.parent?.type === 'DATABASE') return false
  if (page.deletedAt !== null && eventType !== 'page.deleted') return false
  return true
}

/**
 * Claims a batch of `webhook_event` outbox rows (the vectorization-cron
 * claim pattern WITHOUT the dedup collapse — every event delivers).
 */
async function claimBatch(prisma: PrismaClient, opts: FanOutOpts): Promise<OutboxRow[]> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const rows = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
      SELECT id, event_type, aggregate_id, workspace_id, payload, created_at
      FROM outbox_events
      WHERE status = 'PENDING'
        AND next_attempt_at <= now()
        AND aggregate_type = 'webhook_event'
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
  // webhook_event rows are always workspace-scoped; an orphan row cannot
  // resolve subscriptions — drop it.
  if (row.workspace_id === null) {
    await markDone(prisma, row.id)
    return
  }

  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { workspaceId: row.workspace_id, status: 'ACTIVE', events: { has: row.event_type } },
    select: { id: true },
  })
  if (subscriptions.length === 0) {
    await markDone(prisma, row.id)
    return
  }

  const visible = await passesVisibilityGate(prisma, row.aggregate_id, row.event_type)
  if (!visible) {
    await markDone(prisma, row.id)
    return
  }

  const p = (row.payload ?? {}) as WebhookOutboxPayload
  // ONE event id per outbox row — it identifies the EVENT and is shared across
  // every subscription's delivery; consumers dedupe by it.
  const eventId = randomUUID()
  const payload = buildWebhookPayload({
    eventId,
    event: row.event_type,
    workspaceId: row.workspace_id,
    actorId: p.actorId ?? null,
    resourceType: p.resourceType ?? 'page',
    resourceId: row.aggregate_id,
    hints: p.hints ?? {},
    occurredAt: row.created_at,
  })

  await prisma.webhookDelivery.createMany({
    data: subscriptions.map((s) => ({
      subscriptionId: s.id,
      eventType: row.event_type,
      eventId,
      payload: payload as Prisma.InputJsonObject,
    })),
  })
  await markDone(prisma, row.id)
}

/**
 * Fan-out tick: drains `webhook_event` outbox rows into per-subscription
 * `webhook_deliveries` rows (PENDING — the delivery tick sends them).
 */
export async function runFanOutTick(prisma: PrismaClient, opts: FanOutOpts): Promise<void> {
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
