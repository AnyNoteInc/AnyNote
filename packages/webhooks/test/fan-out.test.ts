import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptSecret } from '@repo/auth/secret-encryption.ts'
import { prisma, CollectionKind, type Prisma } from '@repo/db'

import { eventIdForOutboxRow, runFanOutTick } from '../src/worker/fan-out.ts'

// Real-DB integration test for the webhook fan-out tick (outbox → deliveries).
// Self-cleaning via an email-suffix fixture namespace, like the trpc router
// integration tests. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+webhook-fanout-test@anynote.dev'

const TICK_OPTS = { workerId: 'fanout-test-worker', batchSize: 10 }

async function cleanFixtures() {
  const workspaces = await prisma.workspace.findMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
    select: { id: true },
  })
  const wsIds = workspaces.map((w) => w.id)
  await prisma.webhookDelivery.deleteMany({
    where: { subscription: { workspaceId: { in: wsIds } } },
  })
  await prisma.webhookSubscription.deleteMany({ where: { workspaceId: { in: wsIds } } })
  // OutboxEvent has no workspace relation — scope by the fixture workspace ids.
  await prisma.outboxEvent.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.page.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.collection.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

// Seed: owner + workspace + TEAM collection with a page + PERSONAL collection
// (owner-owned) with a page + one ACTIVE subscription.
async function seed() {
  const owner = await makeUser('owner')
  const ws = await prisma.workspace.create({
    data: { name: 'WebhookFanoutWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const personal = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.PERSONAL, title: 'Личное', ownerId: owner.id },
    select: { id: true },
  })
  const teamPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'TEXT',
      title: 'Team page',
      createdById: owner.id,
    },
    select: { id: true },
  })
  const personalPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: personal.id,
      type: 'TEXT',
      title: 'Personal page',
      createdById: owner.id,
    },
    select: { id: true },
  })
  const subscription = await prisma.webhookSubscription.create({
    data: {
      workspaceId: ws.id,
      createdById: owner.id,
      name: 'Test hook',
      url: 'https://hooks.example.com/anynote',
      secretEnc: encryptSecret('whsec_test') as unknown as Prisma.InputJsonValue,
      events: ['page.created', 'page.moved', 'comment.created'],
      status: 'ACTIVE',
    },
    select: { id: true },
  })
  return {
    ownerId: owner.id,
    wsId: ws.id,
    teamCollectionId: team.id,
    personalCollectionId: personal.id,
    teamPageId: teamPage.id,
    personalPageId: personalPage.id,
    subscriptionId: subscription.id,
  }
}

async function enqueueWebhookOutboxRow(args: {
  event: string
  pageId: string
  workspaceId: string
  actorId?: string | null
  resourceType?: 'page' | 'comment'
  hints?: Record<string, unknown>
}) {
  await prisma.outboxEvent.create({
    data: {
      eventType: args.event,
      aggregateType: 'webhook_event',
      aggregateId: args.pageId,
      workspaceId: args.workspaceId,
      payload: {
        resourceType: args.resourceType ?? 'page',
        actorId: args.actorId ?? null,
        hints: (args.hints ?? {}) as Prisma.InputJsonValue,
      },
      // Backdated: Prisma fills @default(now()) from the NODE clock while the
      // claim compares against the POSTGRES clock — skew would flake the claim.
      nextAttemptAt: new Date(Date.now() - 60_000),
    },
  })
}

async function webhookOutboxRows(workspaceId: string) {
  return prisma.outboxEvent.findMany({
    where: { workspaceId, aggregateType: 'webhook_event' },
    select: { status: true, eventType: true },
  })
}

// The shared dev DB can hold foreign PENDING webhook_event rows (Task 3 already
// emits from regular dev usage; the engines cron only arrives in Task 7), and the
// claim is global by design. Tick until the backlog — ours included — is drained,
// bounded so a concurrent writer can't spin us forever.
async function runFanOutUntilDrained() {
  for (let i = 0; i < 50; i++) {
    const pending = await prisma.outboxEvent.count({
      where: {
        aggregateType: 'webhook_event',
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
      },
    })
    if (pending === 0) return
    await runFanOutTick(prisma, TICK_OPTS)
  }
  throw new Error('webhook_event outbox did not drain after 50 ticks')
}

describe('runFanOutTick (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('fans a TEAM page event out to the ACTIVE subscription and marks the outbox row DONE', async () => {
    const fx = await seed()
    await enqueueWebhookOutboxRow({
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
      hints: {},
    })

    await runFanOutUntilDrained()

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { subscriptionId: fx.subscriptionId },
    })
    expect(deliveries).toHaveLength(1)
    const d = deliveries[0]!
    expect(d.status).toBe('PENDING')
    expect(d.eventType).toBe('page.created')
    expect(d.eventId).toMatch(/^[0-9a-f-]{36}$/)

    const payload = d.payload as Record<string, unknown>
    expect(payload).toEqual({
      version: 1,
      id: d.eventId,
      event: 'page.created',
      timestamp: expect.any(String),
      workspaceId: fx.wsId,
      actor: { id: fx.ownerId },
      resource: { type: 'page', id: fx.teamPageId },
      hints: {},
    })
    // The no-content contract — no title (or other content keys) ever leaves.
    expect(JSON.stringify(payload)).not.toContain('"title"')

    const outbox = await webhookOutboxRows(fx.wsId)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.status).toBe('DONE')
  })

  it('drops PERSONAL-collection page events with zero deliveries (no-leak invariant)', async () => {
    const fx = await seed()
    await enqueueWebhookOutboxRow({
      event: 'page.created',
      pageId: fx.personalPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await runFanOutUntilDrained()

    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: fx.subscriptionId } })).toBe(0)
    const outbox = await webhookOutboxRows(fx.wsId)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.status).toBe('DONE')
  })

  it('creates no delivery when the event type is not in subscription.events', async () => {
    const fx = await seed()
    await enqueueWebhookOutboxRow({
      event: 'page.properties_updated',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
      hints: { changed: ['icon'] },
    })

    await runFanOutUntilDrained()

    expect(await prisma.webhookDelivery.count({ where: { subscriptionId: fx.subscriptionId } })).toBe(0)
    expect((await webhookOutboxRows(fx.wsId))[0]!.status).toBe('DONE')
  })

  it('delivers only to ACTIVE subscriptions and shares one eventId across them', async () => {
    const fx = await seed()
    const inactive = await Promise.all(
      (['PENDING', 'DISABLED', 'FAILED'] as const).map((status) =>
        prisma.webhookSubscription.create({
          data: {
            workspaceId: fx.wsId,
            createdById: fx.ownerId,
            name: `${status} hook`,
            url: 'https://hooks.example.com/inactive',
            secretEnc: encryptSecret('whsec_inactive') as unknown as Prisma.InputJsonValue,
            events: ['page.created'],
            status,
          },
          select: { id: true },
        }),
      ),
    )
    const secondActive = await prisma.webhookSubscription.create({
      data: {
        workspaceId: fx.wsId,
        createdById: fx.ownerId,
        name: 'Second active hook',
        url: 'https://hooks.example.com/second',
        secretEnc: encryptSecret('whsec_second') as unknown as Prisma.InputJsonValue,
        events: ['page.created'],
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    await enqueueWebhookOutboxRow({
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await runFanOutUntilDrained()

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { subscription: { workspaceId: fx.wsId } },
      select: { subscriptionId: true, eventId: true },
    })
    expect(deliveries).toHaveLength(2)
    expect(new Set(deliveries.map((d) => d.subscriptionId))).toEqual(
      new Set([fx.subscriptionId, secondActive.id]),
    )
    // ONE event id per outbox row — it identifies the EVENT; consumers dedupe by it.
    expect(new Set(deliveries.map((d) => d.eventId)).size).toBe(1)
    for (const sub of inactive) {
      expect(deliveries.some((d) => d.subscriptionId === sub.id)).toBe(false)
    }
  })

  it('re-fanning out the same outbox row (crash before markDone) yields ONE delivery with a stable eventId', async () => {
    const fx = await seed()
    await enqueueWebhookOutboxRow({
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await runFanOutUntilDrained()

    const first = await prisma.webhookDelivery.findMany({
      where: { subscriptionId: fx.subscriptionId },
    })
    expect(first).toHaveLength(1)
    const firstEventId = first[0]!.eventId

    // The id is DERIVED from the outbox row id — not random — so any redo
    // recomputes the exact same value.
    const outboxRow = await prisma.outboxEvent.findFirstOrThrow({
      where: { workspaceId: fx.wsId, aggregateType: 'webhook_event' },
      select: { id: true },
    })
    expect(firstEventId).toBe(eventIdForOutboxRow(outboxRow.id))

    // Simulate a crash AFTER createMany but BEFORE markDone: the row is
    // re-claimed on the next tick and the fan-out redoes its work.
    await prisma.outboxEvent.updateMany({
      where: { workspaceId: fx.wsId, aggregateType: 'webhook_event' },
      data: {
        status: 'PENDING',
        lockedAt: null,
        lockedBy: null,
        processedAt: null,
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    })

    await runFanOutUntilDrained()

    const second = await prisma.webhookDelivery.findMany({
      where: { subscriptionId: fx.subscriptionId },
    })
    // STILL exactly one delivery — consumers must never see a duplicate they
    // cannot dedupe by eventId.
    expect(second).toHaveLength(1)
    expect(second[0]!.eventId).toBe(firstEventId)
  })

  it('drops events for pages whose parent is a DATABASE page (item-page defense)', async () => {
    const fx = await seed()
    const dbPage = await prisma.page.create({
      data: {
        workspaceId: fx.wsId,
        collectionId: fx.teamCollectionId,
        type: 'DATABASE',
        title: 'Tasks DB',
        createdById: fx.ownerId,
      },
      select: { id: true },
    })
    const itemPage = await prisma.page.create({
      data: {
        workspaceId: fx.wsId,
        collectionId: fx.teamCollectionId,
        parentId: dbPage.id,
        type: 'TEXT',
        title: 'Row item page',
        createdById: fx.ownerId,
      },
      select: { id: true },
    })
    await enqueueWebhookOutboxRow({
      event: 'page.created',
      pageId: itemPage.id,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await runFanOutUntilDrained()

    expect(await prisma.webhookDelivery.count({ where: { subscription: { workspaceId: fx.wsId } } })).toBe(0)
    expect((await webhookOutboxRows(fx.wsId))[0]!.status).toBe('DONE')
  })

  it('fans out page.deleted for a trashed TEAM page but drops other events on it', async () => {
    const fx = await seed()
    await prisma.webhookSubscription.update({
      where: { id: fx.subscriptionId },
      data: { events: ['page.created', 'page.deleted'] },
    })
    await prisma.page.update({
      where: { id: fx.teamPageId },
      data: { deletedAt: new Date() },
    })
    await enqueueWebhookOutboxRow({
      event: 'page.deleted',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })
    await enqueueWebhookOutboxRow({
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await runFanOutUntilDrained()

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { subscriptionId: fx.subscriptionId },
      select: { eventType: true },
    })
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]!.eventType).toBe('page.deleted')

    const outbox = await webhookOutboxRows(fx.wsId)
    expect(outbox).toHaveLength(2)
    expect(outbox.every((r) => r.status === 'DONE')).toBe(true)
  })
})
