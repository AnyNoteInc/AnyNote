import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '@repo/auth/secret-encryption.ts'
import { prisma, CollectionKind, type Prisma } from '@repo/db'
import { buildWebhookPayload } from '@repo/webhooks'

import { runTelegramDeliveryTick, type TelegramDeliverOpts } from '../src/worker/deliver.ts'

// Real-DB integration test for the telegram delivery tick. The Bot API edge is
// an injected fake fetch — everything else (locks, backoff, the send-time
// visibility re-check, auto-disable) runs against postgres. Mirrors
// packages/webhooks/test/deliver.test.ts.

const EMAIL_SUFFIX = '+telegram-deliver-test@anynote.dev'
const BOT_TOKEN = '123456789:AAFakeTokenForDeliverTests_abcde'

// The dev DB is shared across worktrees — derive run-unique telegram chat ids.
const TG_CHAT = String(Date.now())

const URL_BASE = (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')

function tickOpts(fetchFn: unknown, overrides: Partial<TelegramDeliverOpts> = {}): TelegramDeliverOpts {
  return {
    workerId: 'tg-deliver-test-worker',
    batchSize: 10,
    maxAttempts: 3,
    timeoutMs: 5_000,
    fetchFn: fetchFn as typeof fetch,
    ...overrides,
  }
}

/** A Telegram Bot API success body. */
function tgOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
}

/** A Telegram Bot API error body. */
function tgErr(description: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, description }), { status })
}

function fetchCall(fetchFn: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] {
  const call = fetchFn.mock.calls[index]!
  return [String(call[0]), (call[1] ?? {}) as RequestInit]
}

function sentBody(
  fetchFn: ReturnType<typeof vi.fn>,
  index = 0,
): { chat_id?: string; text: string; parse_mode?: string } {
  const [, init] = fetchCall(fetchFn, index)
  return JSON.parse(init.body as string) as { chat_id?: string; text: string; parse_mode?: string }
}

async function cleanFixtures() {
  const workspaces = await prisma.workspace.findMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
    select: { id: true },
  })
  const wsIds = workspaces.map((w) => w.id)
  // Connection delete cascades chats, subscriptions, deliveries and audits.
  await prisma.telegramConnection.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.outboxEvent.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.page.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.collection.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

// Seed: owner + workspace + TEAM collection with a page + PERSONAL collection +
// a second TEAM collection (move target) + ACTIVE connection/chat/subscription.
async function seed(overrides: { consecutiveFailures?: number } = {}) {
  const owner = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'owner',
      firstName: 'Виктор',
      lastName: 'Test',
    },
  })
  const ws = await prisma.workspace.create({
    data: { name: 'TelegramDeliverWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  // Owner-bound: the partial unique index `collections_one_team_per_workspace`
  // allows ONE owner-less TEAM collection per workspace. Still kind TEAM, so
  // it passes the visibility gate and isolates the subscription-equality check.
  const otherTeam = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Другое', ownerId: owner.id },
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
  const connection = await prisma.telegramConnection.create({
    data: {
      workspaceId: ws.id,
      createdById: owner.id,
      botTokenEnc: encryptSecret(BOT_TOKEN) as Prisma.InputJsonValue,
      webhookSecretEnc: encryptSecret('tg-deliver-secret') as Prisma.InputJsonValue,
      status: 'ACTIVE',
      consecutiveFailures: overrides.consecutiveFailures ?? 0,
    },
    select: { id: true },
  })
  const chat = await prisma.telegramChat.create({
    data: {
      connectionId: connection.id,
      chatId: TG_CHAT,
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
    otherTeamCollectionId: otherTeam.id,
    teamPageId: teamPage.id,
    connectionId: connection.id,
    chatRowId: chat.id,
    subscriptionId: subscription.id,
  }
}

async function makeDelivery(
  fx: Awaited<ReturnType<typeof seed>>,
  overrides: {
    attempts?: number
    eventType?: string
    lockedAt?: Date
    lockedBy?: string
    actorId?: string | null
  } = {},
) {
  const eventType = overrides.eventType ?? 'page.created'
  // The stored payload is the 7A metadata envelope the fan-out writes — ids
  // only, NO titles (§6); the title is fetched at send time.
  const payload = buildWebhookPayload({
    eventId: randomUUID(),
    event: eventType,
    workspaceId: fx.wsId,
    actorId: overrides.actorId === undefined ? fx.ownerId : overrides.actorId,
    resourceType: 'page',
    resourceId: fx.teamPageId,
    hints: {},
    occurredAt: new Date(),
  })
  return prisma.telegramDelivery.create({
    data: {
      connectionId: fx.connectionId,
      subscriptionId: fx.subscriptionId,
      eventType,
      eventId: payload.id as string,
      payload: payload as Prisma.InputJsonObject,
      attempts: overrides.attempts ?? 0,
      lockedAt: overrides.lockedAt ?? null,
      lockedBy: overrides.lockedBy ?? null,
      // Backdated: Prisma fills @default(now()) from the NODE clock while the
      // claim compares against the POSTGRES clock — skew would flake the claim.
      nextAttemptAt: new Date(Date.now() - 60_000),
    },
  })
}

async function getDelivery(id: string) {
  return prisma.telegramDelivery.findUniqueOrThrow({ where: { id } })
}

async function getConnection(id: string) {
  return prisma.telegramConnection.findUniqueOrThrow({ where: { id } })
}

describe('runTelegramDeliveryTick (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('sends the rendered message and marks the delivery SENT', async () => {
    const fx = await seed({ consecutiveFailures: 2 })
    const delivery = await makeDelivery(fx)
    // Title changed AFTER fan-out — the message must carry the CURRENT title,
    // fetched at send time (and HTML-escaped for parse_mode HTML).
    await prisma.page.update({
      where: { id: fx.teamPageId },
      data: { title: 'Q&A <план>' },
    })
    const fetchFn = vi.fn(async () => tgOk({ message_id: 42 }))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url] = fetchCall(fetchFn)
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)

    const body = sentBody(fetchFn)
    expect(body.chat_id).toBe(TG_CHAT)
    expect(body.parse_mode).toBe('HTML')
    expect(body.text).toContain(
      `<a href="${URL_BASE}/pages/${fx.teamPageId}">Q&amp;A &lt;план&gt;</a>`,
    )
    // payload.actor.id resolved to the actor's firstName.
    expect(body.text).toMatch(/ — Виктор$/)

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('SENT')
    expect(after.responseSnippet).toContain('42')
    expect(after.lastError).toBeNull()
    expect(after.lockedAt).toBeNull()
    expect(after.lockedBy).toBeNull()

    // Success resets the connection failure streak.
    expect((await getConnection(fx.connectionId)).consecutiveFailures).toBe(0)
  })

  it('renders without an actor suffix when payload.actor.id is null', async () => {
    const fx = await seed()
    await makeDelivery(fx, { actorId: null })
    const fetchFn = vi.fn(async () => tgOk({ message_id: 1 }))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sentBody(fetchFn).text).not.toContain(' — ')
  })

  it('schedules a ~60s backoff retry on a retryable API error and bumps the streak', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () => tgErr('Internal Server Error', 500))
    const before = Date.now()

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('PENDING')
    expect(after.attempts).toBe(1)
    expect(after.lastError).toBe('Internal Server Error')
    expect(after.responseSnippet).toBe('Internal Server Error')
    const delayMs = after.nextAttemptAt.getTime() - before
    expect(delayMs).toBeGreaterThan(55_000)
    expect(delayMs).toBeLessThan(90_000)
    expect(after.lockedAt).toBeNull()
    // EVERY send failure bumps the connection streak (unlike per-subscription
    // webhooks): connection health is attempt-level, reset by any success.
    const conn = await getConnection(fx.connectionId)
    expect(conn.consecutiveFailures).toBe(1)
    expect(conn.status).toBe('ACTIVE')
  })

  it('marks the delivery FAILED when attempts are exhausted', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx, { attempts: 2 })
    const fetchFn = vi.fn(async () => tgErr('Bad Request: message is too long'))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn)) // maxAttempts: 3

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('FAILED')
    expect(after.attempts).toBe(3)
    expect(after.lockedAt).toBeNull()
    expect((await getConnection(fx.connectionId)).consecutiveFailures).toBe(1)
  })

  it('marks the chat LEFT and the delivery SKIPPED when the bot was kicked (403, no retry)', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () =>
      tgErr('Forbidden: bot was kicked from the group chat', 403),
    )

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('SKIPPED')
    expect(after.attempts).toBe(0) // no retry ladder
    expect(after.lockedAt).toBeNull()
    const chat = await prisma.telegramChat.findUniqueOrThrow({ where: { id: fx.chatRowId } })
    expect(chat.status).toBe('LEFT')
    // A dead CHAT is not a connection-health signal — streak untouched.
    expect((await getConnection(fx.connectionId)).consecutiveFailures).toBe(0)
  })

  it('treats "chat not found" like a kicked chat', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () => tgErr('Bad Request: chat not found'))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect((await getDelivery(delivery.id)).status).toBe('SKIPPED')
    expect(
      (await prisma.telegramChat.findUniqueOrThrow({ where: { id: fx.chatRowId } })).status,
    ).toBe('LEFT')
  })

  it('fails terminally on the FIRST tick when the bot token cannot be decrypted', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    // Corrupted/garbage botTokenEnc — permanent until the admin reconnects.
    await prisma.telegramConnection.update({
      where: { id: fx.connectionId },
      data: { botTokenEnc: { garbage: true } as unknown as Prisma.InputJsonValue },
    })
    const fetchFn = vi.fn(async () => tgOk({ message_id: 1 }))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('FAILED')
    expect(after.lastError).toMatch(/decrypt failed/i)
    // Terminal on the first tick — no retry scheduling ever happened.
    expect(after.attempts).toBeLessThanOrEqual(1)
    expect(after.lockedAt).toBeNull()
    // Counted: a permanently broken token must drive auto-disable.
    expect((await getConnection(fx.connectionId)).consecutiveFailures).toBe(1)
  })

  it('skips the delivery without sending when the connection is not ACTIVE', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    await prisma.telegramConnection.update({
      where: { id: fx.connectionId },
      data: { status: 'DISABLED' },
    })
    const fetchFn = vi.fn(async () => tgOk({ message_id: 1 }))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('SKIPPED')
    expect(after.lockedAt).toBeNull()
    expect((await getConnection(fx.connectionId)).consecutiveFailures).toBe(0)
  })

  it('re-checks at send time: a page trashed after fan-out is SKIPPED, never sent', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    await prisma.page.update({
      where: { id: fx.teamPageId },
      data: { deletedAt: new Date() },
    })
    const fetchFn = vi.fn(async () => tgOk({ message_id: 1 }))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('SKIPPED')
    expect(after.lockedAt).toBeNull()
    // Visibility skips do NOT count toward the connection streak.
    expect((await getConnection(fx.connectionId)).consecutiveFailures).toBe(0)
  })

  it('re-checks at send time: a page moved to ANOTHER collection is SKIPPED (subscription mismatch)', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    // Moved to a different TEAM collection — still workspace-visible, but no
    // longer the collection this chat subscribed to. The title must not leak.
    await prisma.page.update({
      where: { id: fx.teamPageId },
      data: { collectionId: fx.otherTeamCollectionId },
    })
    const fetchFn = vi.fn(async () => tgOk({ message_id: 1 }))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('SKIPPED')
    expect((await getConnection(fx.connectionId)).consecutiveFailures).toBe(0)
  })

  it('auto-disables the connection at 10 consecutive failures', async () => {
    const fx = await seed({ consecutiveFailures: 9 })
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () => tgErr('Internal Server Error', 500))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect((await getDelivery(delivery.id)).status).toBe('PENDING') // retry ladder
    const conn = await getConnection(fx.connectionId)
    expect(conn.consecutiveFailures).toBe(10)
    expect(conn.status).toBe('ERROR')
    expect(conn.lastError).toBeTruthy()
    // The bot token must never surface in error strings.
    expect(conn.lastError).not.toContain(BOT_TOKEN)
  })

  it('reclaims a PENDING delivery whose lock went stale (crashed worker) and sends it', async () => {
    const fx = await seed()
    // A worker crash between lock and outcome leaves PENDING + lockedAt set.
    // After the 10-minute reclaim horizon a new tick must pick the row up.
    const delivery = await makeDelivery(fx, {
      lockedAt: new Date(Date.now() - 11 * 60_000),
      lockedBy: 'crashed-worker',
    })
    const fetchFn = vi.fn(async () => tgOk({ message_id: 7 }))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('SENT')
    expect(after.lockedAt).toBeNull()
    expect(after.lockedBy).toBeNull()
  })

  it('does NOT reclaim a PENDING delivery locked recently by a live worker', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx, {
      lockedAt: new Date(Date.now() - 60_000), // 1 minute — well inside the horizon
      lockedBy: 'live-worker',
    })
    const fetchFn = vi.fn(async () => tgOk({ message_id: 1 }))

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('PENDING')
    expect(after.lockedAt).not.toBeNull()
    expect(after.lockedBy).toBe('live-worker')
  })

  it('never lets the bot token reach lastError, even when fetch throws a token-bearing message', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    // Undici-style transport errors can embed the request URL — which embeds
    // the token. TelegramApi must keep surfacing only err.name.
    const fetchFn = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)
    })

    await runTelegramDeliveryTick(prisma, tickOpts(fetchFn))

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('PENDING') // retryable transport failure
    expect(after.attempts).toBe(1)
    expect(after.lastError).toBeTruthy()
    expect(after.lastError).not.toContain(BOT_TOKEN)
    expect(after.responseSnippet ?? '').not.toContain(BOT_TOKEN)
  })
})
