import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '@repo/auth/secret-encryption.ts'
import { prisma, CollectionKind, type Prisma } from '@repo/db'

import { buildWebhookPayload } from '../src/payload.ts'
import { verifyWebhookSignature } from '../src/signature.ts'
import { runDeliveryTick, type DeliverOpts } from '../src/worker/deliver.ts'
import { runFanOutTick } from '../src/worker/fan-out.ts'

import type { LookupFn } from '../src/ssrf.ts'

// Real-DB integration test for the webhook delivery tick. The HTTP edge is an
// injected fake fetch; DNS is an injected fake lookup — everything else (locks,
// backoff, auto-disable, payloads) runs against postgres.

const EMAIL_SUFFIX = '+webhook-deliver-test@anynote.dev'
const SECRET = 'whsec_deliverTestSecret1234567890'
const HOOK_URL = 'https://hooks.example.com/anynote'

const PUBLIC_LOOKUP: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }]
const PRIVATE_LOOKUP: LookupFn = async () => [{ address: '10.0.0.5', family: 4 }]

function tickOpts(fetchFn: unknown, overrides: Partial<DeliverOpts> = {}): DeliverOpts {
  return {
    workerId: 'deliver-test-worker',
    batchSize: 10,
    maxAttempts: 3,
    timeoutMs: 5_000,
    fetchFn: fetchFn as typeof fetch,
    lookup: PUBLIC_LOOKUP,
    ...overrides,
  }
}

function fetchCall(fetchFn: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] {
  const call = fetchFn.mock.calls[index]!
  return [String(call[0]), (call[1] ?? {}) as RequestInit]
}

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
  await prisma.outboxEvent.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.page.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.collection.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed(overrides: { consecutiveFailures?: number } = {}) {
  const owner = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'owner',
      firstName: 'owner',
      lastName: 'Test',
    },
  })
  const ws = await prisma.workspace.create({
    data: { name: 'WebhookDeliverWS', createdById: owner.id },
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
  const subscription = await prisma.webhookSubscription.create({
    data: {
      workspaceId: ws.id,
      createdById: owner.id,
      name: 'Deliver hook',
      url: HOOK_URL,
      secretEnc: encryptSecret(SECRET) as unknown as Prisma.InputJsonValue,
      events: ['page.created', 'page.moved'],
      status: 'ACTIVE',
      consecutiveFailures: overrides.consecutiveFailures ?? 0,
    },
    select: { id: true },
  })
  return {
    ownerId: owner.id,
    wsId: ws.id,
    teamCollectionId: team.id,
    personalCollectionId: personal.id,
    teamPageId: teamPage.id,
    subscriptionId: subscription.id,
  }
}

async function makeDelivery(
  fx: Awaited<ReturnType<typeof seed>>,
  overrides: { attempts?: number; eventType?: string; lockedAt?: Date; lockedBy?: string } = {},
) {
  const eventId = randomUUID()
  const eventType = overrides.eventType ?? 'page.created'
  const payload = buildWebhookPayload({
    eventId,
    event: eventType,
    workspaceId: fx.wsId,
    actorId: fx.ownerId,
    resourceType: 'page',
    resourceId: fx.teamPageId,
    hints: {},
    occurredAt: new Date(),
  })
  return prisma.webhookDelivery.create({
    data: {
      subscriptionId: fx.subscriptionId,
      eventType,
      eventId,
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
  return prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })
}

async function getSubscription(id: string) {
  return prisma.webhookSubscription.findUniqueOrThrow({ where: { id } })
}

// Shared-dev-DB drain (see fan-out.test.ts): tick until no claimable rows remain.
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
    await runFanOutTick(prisma, { workerId: 'deliver-test-fanout', batchSize: 10 })
  }
  throw new Error('webhook_event outbox did not drain after 50 ticks')
}

describe('runDeliveryTick (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('POSTs the signed payload and marks the delivery DELIVERED on 200', async () => {
    const fx = await seed({ consecutiveFailures: 2 })
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () => new Response('ok', { status: 200 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchCall(fetchFn)
    expect(url).toBe(HOOK_URL)
    expect(init.method).toBe('POST')

    const body = init.body as string
    expect(body).toBe(JSON.stringify(delivery.payload))

    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-AnyNote-Event']).toBe('page.created')
    expect(headers['X-AnyNote-Delivery']).toBe(delivery.id)
    expect(headers['X-AnyNote-Payload-Version']).toBe('1')
    const ts = Number(headers['X-AnyNote-Timestamp'])
    expect(Number.isInteger(ts)).toBe(true)
    expect(Math.abs(ts - Math.floor(Date.now() / 1000))).toBeLessThan(60)
    // The signature verifies against the DECRYPTED secret + the sent timestamp.
    expect(verifyWebhookSignature(SECRET, ts, body, headers['X-AnyNote-Signature']!)).toBe(true)

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('DELIVERED')
    expect(after.responseStatus).toBe(200)
    expect(after.latencyMs).not.toBeNull()
    expect(after.lockedAt).toBeNull()
    expect(after.lockedBy).toBeNull()

    const sub = await getSubscription(fx.subscriptionId)
    expect(sub.consecutiveFailures).toBe(0) // reset by the success
  })

  it('schedules a ~60s backoff retry on a 500 response', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () => new Response('server boom', { status: 500 }))
    const before = Date.now()

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('PENDING')
    expect(after.attempts).toBe(1)
    expect(after.responseStatus).toBe(500)
    expect(after.responseSnippet).toBe('server boom')
    const delayMs = after.nextAttemptAt.getTime() - before
    expect(delayMs).toBeGreaterThan(55_000)
    expect(delayMs).toBeLessThan(90_000)
    expect(after.lockedAt).toBeNull()
    // Non-terminal failures do not touch the subscription counter.
    expect((await getSubscription(fx.subscriptionId)).consecutiveFailures).toBe(0)
  })

  it('marks the delivery FAILED and increments consecutiveFailures at maxAttempts', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx, { attempts: 2 })
    const fetchFn = vi.fn(async () => new Response('still broken', { status: 500 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn)) // maxAttempts: 3

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('FAILED')
    expect(after.attempts).toBe(3)
    expect(after.lockedAt).toBeNull()

    const sub = await getSubscription(fx.subscriptionId)
    expect(sub.consecutiveFailures).toBe(1)
    expect(sub.status).toBe('ACTIVE') // below the auto-disable threshold
  })

  it('auto-disables the subscription at 10 consecutive failures and fan-out skips it', async () => {
    const fx = await seed({ consecutiveFailures: 9 })
    const delivery = await makeDelivery(fx, { attempts: 2 })
    const fetchFn = vi.fn(async () => new Response('dead endpoint', { status: 500 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    expect((await getDelivery(delivery.id)).status).toBe('FAILED')
    const sub = await getSubscription(fx.subscriptionId)
    expect(sub.consecutiveFailures).toBe(10)
    expect(sub.status).toBe('FAILED')

    // A fresh event no longer fans out to the disabled subscription.
    await prisma.outboxEvent.create({
      data: {
        eventType: 'page.created',
        aggregateType: 'webhook_event',
        aggregateId: fx.teamPageId,
        workspaceId: fx.wsId,
        payload: { resourceType: 'page', actorId: fx.ownerId, hints: {} },
        nextAttemptAt: new Date(Date.now() - 60_000), // see makeDelivery note
      },
    })
    await runFanOutUntilDrained()
    expect(
      await prisma.webhookDelivery.count({ where: { subscriptionId: fx.subscriptionId } }),
    ).toBe(1) // still only the FAILED one
  })

  it('blocks SSRF targets terminally without calling fetch, counting the failure', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () => new Response('ok', { status: 200 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn, { lookup: PRIVATE_LOOKUP }))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('FAILED')
    expect(after.lastError).toMatch(/blocked/i)
    expect(after.lockedAt).toBeNull()
    // SSRF counts toward consecutiveFailures (broken/hostile endpoint config).
    expect((await getSubscription(fx.subscriptionId)).consecutiveFailures).toBe(1)
  })

  it('fails terminally on the FIRST tick when the subscription secret cannot be decrypted', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    // Corrupted/garbage secretEnc — decryptSecret must not crash the tick into
    // the retry ladder; the failure is permanent until the secret is rotated.
    await prisma.webhookSubscription.update({
      where: { id: fx.subscriptionId },
      data: { secretEnc: { garbage: true } as unknown as Prisma.InputJsonValue },
    })
    const fetchFn = vi.fn(async () => new Response('ok', { status: 200 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('FAILED')
    expect(after.lastError).toMatch(/decrypt failed/i)
    // Terminal on the first tick — no retry scheduling ever happened.
    expect(after.attempts).toBeLessThanOrEqual(1)
    expect(after.lockedAt).toBeNull()
    // Counted: a permanently broken secret must drive auto-disable like SSRF.
    expect((await getSubscription(fx.subscriptionId)).consecutiveFailures).toBe(1)
  })

  it('re-checks visibility at send time: a page moved to PERSONAL fails terminally, uncounted', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    await prisma.page.update({
      where: { id: fx.teamPageId },
      data: { collectionId: fx.personalCollectionId },
    })
    const fetchFn = vi.fn(async () => new Response('ok', { status: 200 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('FAILED')
    expect(after.lastError).toBe('resource no longer workspace-visible')
    expect(after.lockedAt).toBeNull()
    // Visibility terminals do NOT count toward consecutiveFailures.
    expect((await getSubscription(fx.subscriptionId)).consecutiveFailures).toBe(0)
  })

  it('schedules a retry like a 500 when fetch rejects with an abort/timeout', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    })

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('PENDING')
    expect(after.attempts).toBe(1)
    expect(after.responseStatus).toBeNull()
    expect(after.lastError).toMatch(/abort/i)
    expect(after.lockedAt).toBeNull()
  })

  it('truncates the response snippet to 500 chars', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    const fetchFn = vi.fn(async () => new Response('x'.repeat(1_000), { status: 500 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    const after = await getDelivery(delivery.id)
    expect(after.responseSnippet).toHaveLength(500)
    expect(after.responseSnippet).toBe('x'.repeat(500))
  })

  it('reclaims a PENDING delivery whose lock went stale (crashed worker) and delivers it', async () => {
    const fx = await seed()
    // A worker crash between lock and outcome leaves PENDING + lockedAt set.
    // After the 10-minute reclaim horizon a new tick must pick the row up.
    const delivery = await makeDelivery(fx, {
      lockedAt: new Date(Date.now() - 11 * 60_000),
      lockedBy: 'crashed-worker',
    })
    const fetchFn = vi.fn(async () => new Response('ok', { status: 200 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('DELIVERED')
    expect(after.lockedAt).toBeNull()
    expect(after.lockedBy).toBeNull()
  })

  it('does NOT reclaim a PENDING delivery locked recently by a live worker', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx, {
      lockedAt: new Date(Date.now() - 60_000), // 1 minute — well inside the horizon
      lockedBy: 'live-worker',
    })
    const fetchFn = vi.fn(async () => new Response('ok', { status: 200 }))

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).not.toHaveBeenCalled()
    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('PENDING')
    expect(after.lockedAt).not.toBeNull()
    expect(after.lockedBy).toBe('live-worker')
  })

  it('never follows redirects: a 302 is a failure with retry scheduling', async () => {
    const fx = await seed()
    const delivery = await makeDelivery(fx)
    // A redirect could point at a private host and evade the SSRF guard —
    // the request must be sent with redirect: 'manual' and the 3xx treated
    // as a plain failure.
    const fetchFn = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    )

    await runDeliveryTick(prisma, tickOpts(fetchFn))

    expect(fetchFn).toHaveBeenCalledTimes(1) // the redirect is not followed
    const [, init] = fetchCall(fetchFn)
    expect(init.redirect).toBe('manual')

    const after = await getDelivery(delivery.id)
    expect(after.status).toBe('PENDING')
    expect(after.attempts).toBe(1)
    expect(after.responseStatus).toBe(302)
    expect(after.lockedAt).toBeNull()
    expect((await getSubscription(fx.subscriptionId)).consecutiveFailures).toBe(0)
  })
})
