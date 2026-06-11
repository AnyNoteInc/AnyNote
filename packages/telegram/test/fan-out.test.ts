import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { encryptSecret } from '@repo/auth/secret-encryption.ts'
import { prisma, CollectionKind, type Prisma } from '@repo/db'
import { eventIdForOutboxRow, runFanOutTick as runWebhookFanOutTick } from '@repo/webhooks/worker'

import { runTelegramFanOutTick } from '../src/worker/fan-out.ts'

// Real-DB integration test for the telegram fan-out tick (telegram_event
// outbox → telegram_deliveries). Mirrors packages/webhooks/test/fan-out.test.ts.
// Self-cleaning via an email-suffix fixture namespace. Requires
// `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+telegram-fanout-test@anynote.dev'

// The dev DB is shared across worktrees — derive run-unique telegram chat ids.
const RUN = Date.now()
const TG_CHAT = RUN

const TICK_OPTS = { workerId: 'tg-fanout-test-worker', batchSize: 10 }

async function cleanFixtures() {
  const workspaces = await prisma.workspace.findMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
    select: { id: true },
  })
  const wsIds = workspaces.map((w) => w.id)
  // Connection delete cascades chats, subscriptions, deliveries and audits.
  await prisma.telegramConnection.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.webhookDelivery.deleteMany({
    where: { subscription: { workspaceId: { in: wsIds } } },
  })
  await prisma.webhookSubscription.deleteMany({ where: { workspaceId: { in: wsIds } } })
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
// (owner-owned) with a page + a collection-less page + ACTIVE connection with
// one ACTIVE chat carrying one subscription on the TEAM collection.
async function seed() {
  const owner = await makeUser('owner')
  const ws = await prisma.workspace.create({
    data: { name: 'TelegramFanoutWS', createdById: owner.id },
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
  const orphanPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: null,
      type: 'TEXT',
      title: 'Workspace-level page',
      createdById: owner.id,
    },
    select: { id: true },
  })
  const connection = await prisma.telegramConnection.create({
    data: {
      workspaceId: ws.id,
      createdById: owner.id,
      botTokenEnc: encryptSecret(
        '123456789:AAFakeTokenForTests_abcdefghij',
      ) as Prisma.InputJsonValue,
      webhookSecretEnc: encryptSecret('tg-secret-test') as Prisma.InputJsonValue,
      status: 'ACTIVE',
    },
    select: { id: true },
  })
  const chat = await prisma.telegramChat.create({
    data: {
      connectionId: connection.id,
      chatId: String(TG_CHAT),
      type: 'group',
      title: 'Dev chat',
      status: 'ACTIVE',
    },
    select: { id: true },
  })
  const subscription = await prisma.telegramCollectionSubscription.create({
    data: {
      connectionId: connection.id,
      chatId: chat.id,
      collectionId: team.id,
      events: ['page.created', 'page.moved', 'comment.created'],
      createdById: owner.id,
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
    orphanPageId: orphanPage.id,
    connectionId: connection.id,
    chatRowId: chat.id,
    subscriptionId: subscription.id,
  }
}

async function enqueueOutboxRow(args: {
  aggregateType: 'telegram_event' | 'webhook_event'
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
      aggregateType: args.aggregateType,
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

async function outboxRows(workspaceId: string, aggregateType: 'telegram_event' | 'webhook_event') {
  return prisma.outboxEvent.findMany({
    where: { workspaceId, aggregateType },
    select: { status: true, eventType: true },
  })
}

// The shared dev DB can hold foreign PENDING telegram_event rows (dual emission
// is already live; the engines cron only arrives in Task 8), and the claim is
// global by design. Tick until the backlog — ours included — is drained,
// bounded so a concurrent writer can't spin us forever.
async function drainOutbox(aggregateType: 'telegram_event' | 'webhook_event') {
  for (let i = 0; i < 50; i++) {
    const pending = await prisma.outboxEvent.count({
      where: { aggregateType, status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    })
    if (pending === 0) return
    if (aggregateType === 'telegram_event') {
      await runTelegramFanOutTick(prisma, TICK_OPTS)
    } else {
      await runWebhookFanOutTick(prisma, TICK_OPTS)
    }
  }
  throw new Error(`${aggregateType} outbox did not drain after 50 ticks`)
}

describe('runTelegramFanOutTick (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('fans a TEAM page event out to the matching subscription and marks the row DONE', async () => {
    const fx = await seed()
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
      hints: {},
    })

    await drainOutbox('telegram_event')

    const deliveries = await prisma.telegramDelivery.findMany({
      where: { subscriptionId: fx.subscriptionId },
    })
    expect(deliveries).toHaveLength(1)
    const d = deliveries[0]!
    expect(d.status).toBe('PENDING')
    expect(d.eventType).toBe('page.created')
    expect(d.connectionId).toBe(fx.connectionId)

    // The eventId is DERIVED from the outbox row id — deterministic, not random.
    const outboxRow = await prisma.outboxEvent.findFirstOrThrow({
      where: { workspaceId: fx.wsId, aggregateType: 'telegram_event' },
      select: { id: true },
    })
    expect(d.eventId).toBe(eventIdForOutboxRow(outboxRow.id))

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
    // §6: the STORED payload is the metadata envelope — no titles at rest.
    expect(JSON.stringify(payload)).not.toContain('"title"')

    const outbox = await outboxRows(fx.wsId, 'telegram_event')
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.status).toBe('DONE')
  })

  it('gates comment events on their page (aggregate_id IS the page id)', async () => {
    const fx = await seed()
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'comment.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
      resourceType: 'comment',
    })

    await drainOutbox('telegram_event')

    const deliveries = await prisma.telegramDelivery.findMany({
      where: { subscriptionId: fx.subscriptionId },
    })
    expect(deliveries).toHaveLength(1)
    const payload = deliveries[0]!.payload as { resource: { type: string; id: string } }
    expect(payload.resource).toEqual({ type: 'comment', id: fx.teamPageId })
  })

  it('creates no delivery when the event type is not selected by the subscription', async () => {
    const fx = await seed()
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'page.properties_updated',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
      hints: { changed: ['icon'] },
    })

    await drainOutbox('telegram_event')

    expect(
      await prisma.telegramDelivery.count({ where: { connectionId: fx.connectionId } }),
    ).toBe(0)
    expect((await outboxRows(fx.wsId, 'telegram_event'))[0]!.status).toBe('DONE')
  })

  it('creates no delivery when the subscribed chat has LEFT', async () => {
    const fx = await seed()
    await prisma.telegramChat.update({
      where: { id: fx.chatRowId },
      data: { status: 'LEFT' },
    })
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await drainOutbox('telegram_event')

    expect(
      await prisma.telegramDelivery.count({ where: { connectionId: fx.connectionId } }),
    ).toBe(0)
    expect((await outboxRows(fx.wsId, 'telegram_event'))[0]!.status).toBe('DONE')
  })

  it('creates no delivery when the connection is DISABLED', async () => {
    const fx = await seed()
    await prisma.telegramConnection.update({
      where: { id: fx.connectionId },
      data: { status: 'DISABLED' },
    })
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await drainOutbox('telegram_event')

    expect(
      await prisma.telegramDelivery.count({ where: { connectionId: fx.connectionId } }),
    ).toBe(0)
    expect((await outboxRows(fx.wsId, 'telegram_event'))[0]!.status).toBe('DONE')
  })

  it('drops PERSONAL-collection page events even when a subscription matches (gate, defence in depth)', async () => {
    const fx = await seed()
    // Subscriptions are TEAM-only at creation (tRPC guard) — simulate a bypass
    // at the DB level and prove the visibility gate still blocks the fan-out.
    await prisma.telegramCollectionSubscription.create({
      data: {
        connectionId: fx.connectionId,
        chatId: fx.chatRowId,
        collectionId: fx.personalCollectionId,
        events: ['page.created'],
        createdById: fx.ownerId,
      },
    })
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'page.created',
      pageId: fx.personalPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await drainOutbox('telegram_event')

    expect(
      await prisma.telegramDelivery.count({ where: { connectionId: fx.connectionId } }),
    ).toBe(0)
    const outbox = await outboxRows(fx.wsId, 'telegram_event')
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.status).toBe('DONE')
  })

  it('marks rows for collection-less pages DONE with zero deliveries (no subscription can match)', async () => {
    const fx = await seed()
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'page.created',
      pageId: fx.orphanPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await drainOutbox('telegram_event')

    expect(
      await prisma.telegramDelivery.count({ where: { connectionId: fx.connectionId } }),
    ).toBe(0)
    const outbox = await outboxRows(fx.wsId, 'telegram_event')
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.status).toBe('DONE')
  })

  it('re-fanning out the same row (crash before markDone) yields ONE delivery with a stable eventId', async () => {
    const fx = await seed()
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    await drainOutbox('telegram_event')

    const first = await prisma.telegramDelivery.findMany({
      where: { subscriptionId: fx.subscriptionId },
    })
    expect(first).toHaveLength(1)
    const firstEventId = first[0]!.eventId

    // Simulate a crash AFTER createMany but BEFORE markDone: the row is
    // re-claimed on the next tick and the fan-out redoes its work.
    await prisma.outboxEvent.updateMany({
      where: { workspaceId: fx.wsId, aggregateType: 'telegram_event' },
      data: {
        status: 'PENDING',
        lockedAt: null,
        lockedBy: null,
        processedAt: null,
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    })

    await drainOutbox('telegram_event')

    const second = await prisma.telegramDelivery.findMany({
      where: { subscriptionId: fx.subscriptionId },
    })
    // STILL exactly one delivery — (subscriptionId, eventId) unique + skipDuplicates.
    expect(second).toHaveLength(1)
    expect(second[0]!.eventId).toBe(firstEventId)
  })

  it('telegram and webhook ticks each consume ONLY their own aggregateType', async () => {
    const fx = await seed()
    const webhookSub = await prisma.webhookSubscription.create({
      data: {
        workspaceId: fx.wsId,
        createdById: fx.ownerId,
        name: 'Isolation hook',
        url: 'https://hooks.example.com/isolation',
        secretEnc: encryptSecret('whsec_isolation') as unknown as Prisma.InputJsonValue,
        events: ['page.created'],
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    await enqueueOutboxRow({
      aggregateType: 'telegram_event',
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })
    await enqueueOutboxRow({
      aggregateType: 'webhook_event',
      event: 'page.created',
      pageId: fx.teamPageId,
      workspaceId: fx.wsId,
      actorId: fx.ownerId,
    })

    // Telegram tick first: it must drain telegram_event and NOT touch webhook_event.
    await drainOutbox('telegram_event')

    expect((await outboxRows(fx.wsId, 'telegram_event'))[0]!.status).toBe('DONE')
    expect((await outboxRows(fx.wsId, 'webhook_event'))[0]!.status).toBe('PENDING')
    expect(
      await prisma.telegramDelivery.count({ where: { subscriptionId: fx.subscriptionId } }),
    ).toBe(1)
    expect(
      await prisma.webhookDelivery.count({ where: { subscriptionId: webhookSub.id } }),
    ).toBe(0)

    // Webhook tick second: drains its own row, leaves telegram deliveries alone.
    await drainOutbox('webhook_event')

    expect((await outboxRows(fx.wsId, 'webhook_event'))[0]!.status).toBe('DONE')
    expect(
      await prisma.webhookDelivery.count({ where: { subscriptionId: webhookSub.id } }),
    ).toBe(1)
    expect(
      await prisma.telegramDelivery.count({ where: { subscriptionId: fx.subscriptionId } }),
    ).toBe(1)
  })
})
