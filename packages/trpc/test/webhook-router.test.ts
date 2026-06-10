import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')

// The challenge sender is the only mocked edge (vi.mock keeps the module's
// other exports real) — everything else runs against postgres.
const { sendVerificationChallengeMock } = vi.hoisted(() => ({
  sendVerificationChallengeMock: vi.fn(),
}))

vi.mock('@repo/webhooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@repo/webhooks')>()),
  sendVerificationChallenge: sendVerificationChallengeMock,
}))

import { prisma, type Prisma } from '@repo/db'
import { decryptSecret, encryptSecret, type EncryptedPayload } from '@repo/auth'
import { signWebhookPayload, verifyWebhookSignature } from '@repo/webhooks'

import { webhookRouter } from '../src/routers/webhook'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the webhook router. Email-suffix fixture
// namespace, self-cleaning. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+webhook-router-test@anynote.dev'
const HOOK_URL = 'https://hooks.example.com/anynote'
// Dedicated plan slug: the happy fixtures need `developerSpaceEnabled: true`,
// and flipping the flag on the shared dev DB's `personal` plan would be a
// DB-wide change. The owner gets an ACTIVE subscription to this plan instead.
const PRO_PLAN_SLUG = 'wh-test-pro'

async function cleanFixtures() {
  const byWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.webhookDelivery.deleteMany({ where: { subscription: byWs } })
  await prisma.webhookSubscription.deleteMany({ where: byWs })
  await prisma.workspaceMember.deleteMany({ where: byWs })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.subscription.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
  await prisma.plan.deleteMany({ where: { slug: PRO_PLAN_SLUG } })
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

function makeCaller(userId: string) {
  return createCallerFactory(webhookRouter)({
    prisma,
    user: { id: userId, email: 'x', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
    jobs: { kick: vi.fn() },
  })
}

// getWorkspaceFeatures falls back to the `personal` plan when the workspace
// owner has no ACTIVE subscription — make it self-contained for a fresh CI DB.
// Deliberately does NOT touch developerSpaceEnabled (default false) so the
// no-flag fixture stays a real personal-plan workspace.
async function ensurePersonalPlan() {
  await prisma.plan.upsert({
    where: { slug: 'personal' },
    update: {},
    create: { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
  })
}

async function ensureProPlan() {
  return prisma.plan.upsert({
    where: { slug: PRO_PLAN_SLUG },
    update: { developerSpaceEnabled: true },
    create: {
      slug: PRO_PLAN_SLUG,
      name: 'Webhook Test Pro',
      developerSpaceEnabled: true,
      sortOrder: 99,
    },
  })
}

async function seed() {
  await ensurePersonalPlan()
  const plan = await ensureProPlan()
  const owner = await makeUser('owner')
  const editor = await makeUser('editor')
  await prisma.subscription.create({
    data: { userId: owner.id, planId: plan.id, status: 'ACTIVE' },
  })
  const ws = await prisma.workspace.create({ data: { name: 'WebhookWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: editor.id, role: 'EDITOR' },
    ],
  })
  return { owner, editor, ws }
}

const createInput = (workspaceId: string) => ({
  workspaceId,
  name: 'CI hook',
  url: HOOK_URL,
  events: ['page.created' as const],
})

describe('webhook router', () => {
  beforeEach(async () => {
    await cleanFixtures()
    sendVerificationChallengeMock.mockReset()
    sendVerificationChallengeMock.mockResolvedValue({ ok: true })
  })
  afterAll(cleanFixtures)

  it('create returns the secret once and activates on a successful challenge', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const res = await caller.create(createInput(ws.id))
    expect(res.secret).toMatch(/^whsec_/)
    expect(res.status).toBe('ACTIVE')
    expect(sendVerificationChallengeMock).toHaveBeenCalledTimes(1)
    expect(sendVerificationChallengeMock.mock.calls[0]![0]).toMatchObject({
      url: HOOK_URL,
      secret: res.secret,
      subscriptionId: res.id,
    })
    const row = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: res.id } })
    expect(row.status).toBe('ACTIVE')
    expect(row.verifiedAt).not.toBeNull()
    expect(row.verificationChallenge).toBeNull()
    // Encrypted at rest, decrypts back to the returned secret.
    expect(JSON.stringify(row.secretEnc)).not.toContain(res.secret)
    expect(decryptSecret(row.secretEnc as unknown as EncryptedPayload)).toBe(res.secret)
  })

  it('a failed challenge leaves the subscription PENDING', async () => {
    sendVerificationChallengeMock.mockResolvedValue({ ok: false, error: 'http 500' })
    const { owner, ws } = await seed()
    const res = await makeCaller(owner.id).create(createInput(ws.id))
    expect(res.status).toBe('PENDING')
    expect(res.secret).toMatch(/^whsec_/)
    const row = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: res.id } })
    expect(row.status).toBe('PENDING')
    expect(row.verifiedAt).toBeNull()
    expect(row.verificationChallenge).not.toBeNull()
  })

  it('list never exposes the secret or the challenge', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const created = await caller.create(createInput(ws.id))
    const rows = await caller.list({ workspaceId: ws.id })
    expect(rows.length).toBe(1)
    expect(rows[0]).not.toHaveProperty('secretEnc')
    expect(rows[0]).not.toHaveProperty('verificationChallenge')
    expect(JSON.stringify(rows)).not.toContain(created.secret)
  })

  it('EDITOR is FORBIDDEN', async () => {
    const { editor, ws } = await seed()
    const caller = makeCaller(editor.id)
    await expect(caller.list({ workspaceId: ws.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Недостаточно прав',
    })
    await expect(caller.create(createInput(ws.id))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('a plan without developerSpaceEnabled is FORBIDDEN (personal fallback)', async () => {
    await seed()
    // Owner WITHOUT any billing subscription → personal plan, flag false.
    const freeOwner = await makeUser('free-owner')
    const freeWs = await prisma.workspace.create({
      data: { name: 'FreeWS', createdById: freeOwner.id },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: freeWs.id, userId: freeOwner.id, role: 'OWNER' },
    })
    await expect(makeCaller(freeOwner.id).list({ workspaceId: freeWs.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'DEVELOPER_SPACE_NOT_IN_PLAN',
    })
  })

  it('rejects a non-https url with BAD_REQUEST', async () => {
    const { owner, ws } = await seed()
    await expect(
      makeCaller(owner.id).create({
        ...createInput(ws.id),
        url: 'http://insecure.example.com/hook',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Только https:// адреса' })
    expect(sendVerificationChallengeMock).not.toHaveBeenCalled()
    expect(await prisma.webhookSubscription.count({ where: { workspaceId: ws.id } })).toBe(0)
  })

  it('rejects the 21st subscription with BAD_REQUEST', async () => {
    const { owner, ws } = await seed()
    await prisma.webhookSubscription.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        workspaceId: ws.id,
        createdById: owner.id,
        name: `hook-${i}`,
        url: HOOK_URL,
        secretEnc: encryptSecret(`whsec_existing${i}`) as unknown as Prisma.InputJsonValue,
        events: ['page.created'],
      })),
    })
    await expect(makeCaller(owner.id).create(createInput(ws.id))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('rotateSecret returns a new secret and old signatures stop verifying', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const created = await caller.create(createInput(ws.id))
    const { secret: rotated } = await caller.rotateSecret({
      id: created.id,
      workspaceId: ws.id,
    })
    expect(rotated).toMatch(/^whsec_/)
    expect(rotated).not.toBe(created.secret)
    const row = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: created.id } })
    const stored = decryptSecret(row.secretEnc as unknown as EncryptedPayload)
    expect(stored).toBe(rotated)
    const body = '{"version":1}'
    const ts = Math.floor(Date.now() / 1000)
    const oldSignature = signWebhookPayload(created.secret, ts, body)
    expect(verifyWebhookSignature(stored, ts, body, oldSignature)).toBe(false)
    expect(verifyWebhookSignature(stored, ts, body, signWebhookPayload(rotated, ts, body))).toBe(
      true,
    )
  })

  it('setEnabled resume requires a verified address', async () => {
    sendVerificationChallengeMock.mockResolvedValue({ ok: false, error: 'http 500' })
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const created = await caller.create(createInput(ws.id)) // stays PENDING, never verified
    await expect(
      caller.setEnabled({ id: created.id, workspaceId: ws.id, enabled: true }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Сначала подтвердите адрес' })
  })

  it('verify on a FAILED subscription reactivates it on a successful challenge', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const created = await caller.create(createInput(ws.id)) // ACTIVE
    // Simulate the dispatch worker auto-disabling after consecutive failures.
    await prisma.webhookSubscription.update({
      where: { id: created.id },
      data: { status: 'FAILED', consecutiveFailures: 8 },
    })
    const res = await caller.verify({ id: created.id, workspaceId: ws.id })
    expect(res.status).toBe('ACTIVE')
    const row = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.status).toBe('ACTIVE')
    expect(row.consecutiveFailures).toBe(0)
    expect(row.verificationChallenge).toBeNull()
  })

  it('update with a URL change re-runs the challenge; non-https is rejected outright', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const created = await caller.create(createInput(ws.id)) // ACTIVE
    expect(sendVerificationChallengeMock).toHaveBeenCalledTimes(1)

    // Challenge success → ACTIVE with the new url.
    const newUrl = 'https://hooks.example.com/anynote-v2'
    const ok = await caller.update({ id: created.id, workspaceId: ws.id, url: newUrl })
    expect(ok).toMatchObject({ status: 'ACTIVE', url: newUrl })
    expect(sendVerificationChallengeMock).toHaveBeenCalledTimes(2)
    expect(sendVerificationChallengeMock.mock.calls[1]![0]).toMatchObject({ url: newUrl })

    // Challenge failure → PENDING, old verification invalidated.
    sendVerificationChallengeMock.mockResolvedValue({ ok: false, error: 'http 500' })
    const failed = await caller.update({
      id: created.id,
      workspaceId: ws.id,
      url: 'https://hooks.example.com/anynote-v3',
    })
    expect(failed.status).toBe('PENDING')
    const row = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.status).toBe('PENDING')
    expect(row.verifiedAt).toBeNull()
    expect(row.verificationChallenge).not.toBeNull()

    // Non-https url → BAD_REQUEST, no challenge attempt.
    expect(sendVerificationChallengeMock).toHaveBeenCalledTimes(3)
    await expect(
      caller.update({ id: created.id, workspaceId: ws.id, url: 'http://insecure.example.com' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Только https:// адреса' })
    expect(sendVerificationChallengeMock).toHaveBeenCalledTimes(3)
  })

  it('update without a URL change skips the challenge and never returns the secret', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const created = await caller.create(createInput(ws.id))
    expect(sendVerificationChallengeMock).toHaveBeenCalledTimes(1)
    const res = await caller.update({
      id: created.id,
      workspaceId: ws.id,
      name: 'Renamed hook',
      events: ['page.created', 'page.deleted'],
    })
    // No url change → no re-verification.
    expect(sendVerificationChallengeMock).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({
      id: created.id,
      name: 'Renamed hook',
      events: ['page.created', 'page.deleted'],
      status: 'ACTIVE',
    })
    // SAFE_SELECT shape — never the secret or the challenge.
    expect(res).not.toHaveProperty('secretEnc')
    expect(res).not.toHaveProperty('verificationChallenge')
    expect(JSON.stringify(res)).not.toContain(created.secret)
  })

  it('verify on an ACTIVE subscription is idempotent and uses the stored secret', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const created = await caller.create(createInput(ws.id)) // ACTIVE
    const res = await caller.verify({ id: created.id, workspaceId: ws.id })
    expect(res.status).toBe('ACTIVE')
    const row = await prisma.webhookSubscription.findUniqueOrThrow({ where: { id: created.id } })
    expect(row.status).toBe('ACTIVE')
    // The challenge was signed with the DECRYPTED stored secret (the one
    // returned at create) and the configurable timeout.
    expect(sendVerificationChallengeMock).toHaveBeenCalledTimes(2)
    expect(sendVerificationChallengeMock.mock.calls[1]![0]).toMatchObject({
      url: HOOK_URL,
      secret: created.secret,
      subscriptionId: created.id,
      timeoutMs: 10_000,
    })
  })

  it('deliveries paginates by 30 and is scoped to the workspace', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const created = await caller.create(createInput(ws.id))
    const base = Date.now()
    await prisma.webhookDelivery.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        subscriptionId: created.id,
        eventType: 'page.created',
        eventId: randomUUID(),
        payload: { version: 1 } as Prisma.InputJsonObject,
        createdAt: new Date(base - i * 1000),
      })),
    })

    const page1 = await caller.deliveries({ workspaceId: ws.id, subscriptionId: created.id })
    expect(page1.items.length).toBe(30)
    expect(page1.nextCursor).not.toBeNull()
    expect(page1.items[0]).not.toHaveProperty('payload')

    const page2 = await caller.deliveries({
      workspaceId: ws.id,
      subscriptionId: created.id,
      cursor: page1.nextCursor!,
    })
    expect(page2.items.length).toBe(5)
    expect(page2.nextCursor).toBeNull()
    const ids = new Set([...page1.items, ...page2.items].map((d) => d.id))
    expect(ids.size).toBe(35)

    // Foreign workspace (also owner-managed, plan flag on) cannot read this log.
    const otherWs = await prisma.workspace.create({
      data: { name: 'OtherWS', createdById: owner.id },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: otherWs.id, userId: owner.id, role: 'OWNER' },
    })
    await expect(
      caller.deliveries({ workspaceId: otherWs.id, subscriptionId: created.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
