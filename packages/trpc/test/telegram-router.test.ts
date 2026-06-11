import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
process.env.BETTER_AUTH_URL ||= 'http://localhost:3000'

// The Bot API client is the only mocked edge (vi.mock keeps the module's
// other exports real) — everything else runs against postgres.
const { telegramApiMock } = vi.hoisted(() => ({
  telegramApiMock: {
    constructed: [] as Array<{ token: string; opts?: { timeoutMs?: number } }>,
    getMe: vi.fn(),
    setWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    sendMessage: vi.fn(),
  },
}))

vi.mock('@repo/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/telegram')>()
  class MockTelegramApi {
    constructor(token: string, opts?: { timeoutMs?: number }) {
      telegramApiMock.constructed.push({ token, opts })
    }
    getMe = telegramApiMock.getMe
    setWebhook = telegramApiMock.setWebhook
    deleteWebhook = telegramApiMock.deleteWebhook
    sendMessage = telegramApiMock.sendMessage
  }
  return { ...actual, TelegramApi: MockTelegramApi }
})

import { prisma, type Prisma } from '@repo/db'
import { decryptSecret, type EncryptedPayload } from '@repo/auth'
import { hashLinkCode } from '@repo/telegram'

import { telegramRouter } from '../src/routers/telegram'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the telegram router. Email-suffix fixture
// namespace, self-cleaning. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+telegram-router-test@anynote.dev'
// Matches /^\d+:[\w-]{30,}$/ — well-formed, obviously fake.
const GOOD_TOKEN = '123456789:AAFakeTokenForRouterTests_0123456789'
const SECOND_TOKEN = '987654321:BBFakeTokenForReconnects_9876543210'
// Dedicated plan slug: the happy fixtures need `developerSpaceEnabled: true`,
// and flipping the flag on the shared dev DB's `personal` plan would be a
// DB-wide change. The owner gets an ACTIVE subscription to this plan instead.
const PRO_PLAN_SLUG = 'tg-test-pro'

async function cleanFixtures() {
  const byCreatorWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  // Connection cascade removes chats, subscriptions, deliveries and audits.
  await prisma.telegramConnection.deleteMany({ where: byCreatorWs })
  await prisma.telegramLinkCode.deleteMany({ where: byUser })
  await prisma.telegramUserLink.deleteMany({ where: byUser })
  await prisma.collection.deleteMany({ where: byCreatorWs })
  await prisma.workspaceMember.deleteMany({ where: byCreatorWs })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.subscription.deleteMany({ where: byUser })
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
  return createCallerFactory(telegramRouter)({
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
      name: 'Telegram Test Pro',
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
  const ws = await prisma.workspace.create({ data: { name: 'TelegramWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: editor.id, role: 'EDITOR' },
    ],
  })
  return { owner, editor, ws }
}

function makeCollection(workspaceId: string, kind: 'TEAM' | 'PERSONAL', title: string) {
  return prisma.collection.create({ data: { workspaceId, kind, title } })
}

function makeChat(connectionId: string, chatId: string, title = 'Команда') {
  return prisma.telegramChat.create({
    data: { connectionId, chatId, type: 'group', title },
  })
}

/** Mock a healthy bot and run `connect`; returns the router result. */
async function connectActive(caller: ReturnType<typeof makeCaller>, workspaceId: string) {
  telegramApiMock.getMe.mockResolvedValue({
    ok: true,
    result: { id: 42, username: 'anynote_bot' },
  })
  telegramApiMock.setWebhook.mockResolvedValue({ ok: true, result: true })
  return caller.connect({ workspaceId, botToken: GOOD_TOKEN })
}

describe('telegram router', () => {
  beforeEach(async () => {
    await cleanFixtures()
    telegramApiMock.constructed.length = 0
    telegramApiMock.getMe.mockReset()
    telegramApiMock.setWebhook.mockReset()
    telegramApiMock.deleteWebhook.mockReset()
    telegramApiMock.sendMessage.mockReset()
    telegramApiMock.deleteWebhook.mockResolvedValue({ ok: true, result: true })
  })
  afterAll(cleanFixtures)

  it('connect activates the connection and stores both secrets encrypted', async () => {
    const { owner, ws } = await seed()
    const res = await connectActive(makeCaller(owner.id), ws.id)
    expect(res.status).toBe('ACTIVE')
    expect(res.botUsername).toBe('anynote_bot')
    expect(res).not.toHaveProperty('botTokenEnc')
    expect(res).not.toHaveProperty('webhookSecretEnc')
    expect(JSON.stringify(res)).not.toContain(GOOD_TOKEN)

    const row = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(row.status).toBe('ACTIVE')
    expect(row.botUsername).toBe('anynote_bot')
    expect(row.lastError).toBeNull()
    // Encrypted at rest — the plaintext token appears nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(GOOD_TOKEN)
    expect(decryptSecret(row.botTokenEnc as unknown as EncryptedPayload)).toBe(GOOD_TOKEN)

    // The API client was built with the plaintext token + configured timeout.
    expect(telegramApiMock.constructed).toEqual([
      { token: GOOD_TOKEN, opts: { timeoutMs: 10_000 } },
    ])
    expect(telegramApiMock.getMe).toHaveBeenCalledTimes(1)
    // setWebhook got the per-connection URL and the PLAINTEXT secret that
    // decrypts back from webhookSecretEnc.
    expect(telegramApiMock.setWebhook).toHaveBeenCalledTimes(1)
    const [url, secret] = telegramApiMock.setWebhook.mock.calls[0]! as [string, string]
    expect(url).toBe(`${process.env.BETTER_AUTH_URL}/api/telegram/webhook/${row.id}`)
    expect(secret).toHaveLength(32)
    expect(decryptSecret(row.webhookSecretEnc as unknown as EncryptedPayload)).toBe(secret)
    expect(JSON.stringify(row)).not.toContain(secret)
  })

  it('rejects a malformed token with BAD_REQUEST before any network call', async () => {
    const { owner, ws } = await seed()
    await expect(
      makeCaller(owner.id).connect({ workspaceId: ws.id, botToken: 'not-a-bot-token' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(telegramApiMock.getMe).not.toHaveBeenCalled()
    expect(telegramApiMock.setWebhook).not.toHaveBeenCalled()
    expect(await prisma.telegramConnection.count({ where: { workspaceId: ws.id } })).toBe(0)
  })

  it('getMe failure persists ERROR with the sanitized description only', async () => {
    const { owner, ws } = await seed()
    telegramApiMock.getMe.mockResolvedValue({ ok: false, description: 'Unauthorized' })
    const res = await makeCaller(owner.id).connect({ workspaceId: ws.id, botToken: GOOD_TOKEN })
    expect(res.status).toBe('ERROR')
    expect(res.lastError).toBe('Unauthorized')
    expect(telegramApiMock.setWebhook).not.toHaveBeenCalled()
    const row = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(row.status).toBe('ERROR')
    expect(row.lastError).toBe('Unauthorized')
    expect(row.lastError).not.toContain(GOOD_TOKEN)
  })

  it('setWebhook failure persists ERROR but keeps the botUsername from getMe', async () => {
    const { owner, ws } = await seed()
    telegramApiMock.getMe.mockResolvedValue({
      ok: true,
      result: { id: 42, username: 'anynote_bot' },
    })
    telegramApiMock.setWebhook.mockResolvedValue({ ok: false, description: 'bad webhook url' })
    const res = await makeCaller(owner.id).connect({ workspaceId: ws.id, botToken: GOOD_TOKEN })
    expect(res.status).toBe('ERROR')
    expect(res.lastError).toBe('bad webhook url')
    expect(res.botUsername).toBe('anynote_bot')
  })

  it('re-connect reuses the single per-workspace row, replaces secrets and resets failures', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    const first = await connectActive(caller, ws.id)
    const before = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    await prisma.telegramConnection.update({
      where: { id: before.id },
      data: { status: 'ERROR', consecutiveFailures: 7, lastError: 'kaput' },
    })

    const second = await caller.connect({ workspaceId: ws.id, botToken: SECOND_TOKEN })
    expect(second.id).toBe(first.id)
    expect(second.status).toBe('ACTIVE')
    const after = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(after.id).toBe(before.id)
    expect(after.consecutiveFailures).toBe(0)
    expect(after.lastError).toBeNull()
    expect(decryptSecret(after.botTokenEnc as unknown as EncryptedPayload)).toBe(SECOND_TOKEN)
    expect(decryptSecret(after.webhookSecretEnc as unknown as EncryptedPayload)).not.toBe(
      decryptSecret(before.webhookSecretEnc as unknown as EncryptedPayload),
    )
  })

  it('EDITOR is FORBIDDEN on every managed procedure', async () => {
    const { editor, ws } = await seed()
    const caller = makeCaller(editor.id)
    const id = randomUUID()
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['getConnection', () => caller.getConnection({ workspaceId: ws.id })],
      ['connect', () => caller.connect({ workspaceId: ws.id, botToken: GOOD_TOKEN })],
      ['verify', () => caller.verify({ workspaceId: ws.id })],
      ['disconnect', () => caller.disconnect({ workspaceId: ws.id })],
      ['listChats', () => caller.listChats({ workspaceId: ws.id })],
      ['removeChat', () => caller.removeChat({ workspaceId: ws.id, chatId: id })],
      [
        'createSubscription',
        () =>
          caller.createSubscription({
            workspaceId: ws.id,
            chatId: id,
            collectionId: id,
            events: ['page.created'],
          }),
      ],
      [
        'updateSubscription',
        () => caller.updateSubscription({ workspaceId: ws.id, id, events: ['page.created'] }),
      ],
      ['deleteSubscription', () => caller.deleteSubscription({ workspaceId: ws.id, id })],
      ['listSubscriptions', () => caller.listSubscriptions({ workspaceId: ws.id })],
      ['deliveries', () => caller.deliveries({ workspaceId: ws.id })],
      ['auditLog', () => caller.auditLog({ workspaceId: ws.id })],
    ]
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Недостаточно прав',
      })
    }
    expect(telegramApiMock.getMe).not.toHaveBeenCalled()
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
    await expect(
      makeCaller(freeOwner.id).getConnection({ workspaceId: freeWs.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'DEVELOPER_SPACE_NOT_IN_PLAN' })
    await expect(
      makeCaller(freeOwner.id).connect({ workspaceId: freeWs.id, botToken: GOOD_TOKEN }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'DEVELOPER_SPACE_NOT_IN_PLAN' })
  })

  it('createSubscription rejects PERSONAL collections with «Только командные разделы»', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const chat = await makeChat(connection.id, '100')
    const personal = await makeCollection(ws.id, 'PERSONAL', 'Личное')
    await expect(
      caller.createSubscription({
        workspaceId: ws.id,
        chatId: chat.id,
        collectionId: personal.id,
        events: ['page.created'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Только командные разделы' })
    expect(await prisma.telegramCollectionSubscription.count()).toBe(0)
  })

  it('createSubscription rejects a foreign-workspace collection with NOT_FOUND', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const chat = await makeChat(connection.id, '100')
    // Another workspace of the SAME owner (plan flag on) — still not subscribable.
    const otherWs = await prisma.workspace.create({
      data: { name: 'OtherWS', createdById: owner.id },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: otherWs.id, userId: owner.id, role: 'OWNER' },
    })
    const foreign = await makeCollection(otherWs.id, 'TEAM', 'Чужая')
    await expect(
      caller.createSubscription({
        workspaceId: ws.id,
        chatId: chat.id,
        collectionId: foreign.id,
        events: ['page.created'],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('createSubscription validates chat ownership, events, duplicates and the 50-cap', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const chat = await makeChat(connection.id, '100')
    const team = await makeCollection(ws.id, 'TEAM', 'Команда')

    // Foreign chat id → NOT_FOUND.
    await expect(
      caller.createSubscription({
        workspaceId: ws.id,
        chatId: randomUUID(),
        collectionId: team.id,
        events: ['page.created'],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    // Empty / unknown event types → BAD_REQUEST (zod).
    await expect(
      caller.createSubscription({
        workspaceId: ws.id,
        chatId: chat.id,
        collectionId: team.id,
        events: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      caller.createSubscription({
        workspaceId: ws.id,
        chatId: chat.id,
        collectionId: team.id,
        events: ['nope.event' as never],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    const created = await caller.createSubscription({
      workspaceId: ws.id,
      chatId: chat.id,
      collectionId: team.id,
      events: ['page.created', 'comment.created'],
    })
    expect(created.events).toEqual(['page.created', 'comment.created'])

    // Same chat + collection again → friendly BAD_REQUEST, not a P2002 blowup.
    await expect(
      caller.createSubscription({
        workspaceId: ws.id,
        chatId: chat.id,
        collectionId: team.id,
        events: ['page.created'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // Fill up to the cap (49 more chats × the same collection), then the 51st fails.
    await prisma.telegramChat.createMany({
      data: Array.from({ length: 49 }, (_, i) => ({
        id: randomUUID(),
        connectionId: connection.id,
        chatId: `cap-${i}`,
        type: 'group',
      })),
    })
    const capChats = await prisma.telegramChat.findMany({
      where: { connectionId: connection.id, chatId: { startsWith: 'cap-' } },
    })
    await prisma.telegramCollectionSubscription.createMany({
      data: capChats.map((c) => ({
        connectionId: connection.id,
        chatId: c.id,
        collectionId: team.id,
        events: ['page.created'],
        createdById: owner.id,
      })),
    })
    const overflowChat = await makeChat(connection.id, 'overflow')
    await expect(
      caller.createSubscription({
        workspaceId: ws.id,
        chatId: overflowChat.id,
        collectionId: team.id,
        events: ['page.created'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('updateSubscription / deleteSubscription are scoped to the workspace connection', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const chat = await makeChat(connection.id, '100')
    const team = await makeCollection(ws.id, 'TEAM', 'Команда')
    const sub = await caller.createSubscription({
      workspaceId: ws.id,
      chatId: chat.id,
      collectionId: team.id,
      events: ['page.created'],
    })

    // Foreign workspace (owner-managed, plan flag on) cannot touch it.
    const otherWs = await prisma.workspace.create({
      data: { name: 'OtherWS', createdById: owner.id },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: otherWs.id, userId: owner.id, role: 'OWNER' },
    })
    await expect(
      caller.updateSubscription({ workspaceId: otherWs.id, id: sub.id, events: ['page.moved'] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      caller.deleteSubscription({ workspaceId: otherWs.id, id: sub.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const updated = await caller.updateSubscription({
      workspaceId: ws.id,
      id: sub.id,
      events: ['page.moved'],
    })
    expect(updated.events).toEqual(['page.moved'])

    await caller.deleteSubscription({ workspaceId: ws.id, id: sub.id })
    expect(await prisma.telegramCollectionSubscription.count({ where: { id: sub.id } })).toBe(0)
  })

  it('listSubscriptions includes chat and collection titles; removeChat cascades', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const chat = await makeChat(connection.id, '100', 'Дев-чат')
    const team = await makeCollection(ws.id, 'TEAM', 'Команда')
    await caller.createSubscription({
      workspaceId: ws.id,
      chatId: chat.id,
      collectionId: team.id,
      events: ['page.created'],
    })

    const chats = await caller.listChats({ workspaceId: ws.id })
    expect(chats).toHaveLength(1)
    expect(chats[0]).toMatchObject({ id: chat.id, title: 'Дев-чат', type: 'group' })

    const subs = await caller.listSubscriptions({ workspaceId: ws.id })
    expect(subs).toHaveLength(1)
    expect(subs[0]!.chat).toMatchObject({ title: 'Дев-чат' })
    expect(subs[0]!.collection).toMatchObject({ title: 'Команда' })

    // Foreign chat id → NOT_FOUND; real one cascades its subscriptions.
    await expect(
      caller.removeChat({ workspaceId: ws.id, chatId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await caller.removeChat({ workspaceId: ws.id, chatId: chat.id })
    expect(await prisma.telegramChat.count({ where: { connectionId: connection.id } })).toBe(0)
    expect(
      await prisma.telegramCollectionSubscription.count({
        where: { connectionId: connection.id },
      }),
    ).toBe(0)
  })

  it('no read shape ever exposes the token or the webhook secret', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const secret = telegramApiMock.setWebhook.mock.calls[0]![1] as string
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const chat = await makeChat(connection.id, '100')
    const team = await makeCollection(ws.id, 'TEAM', 'Команда')
    const sub = await caller.createSubscription({
      workspaceId: ws.id,
      chatId: chat.id,
      collectionId: team.id,
      events: ['page.created'],
    })
    await prisma.telegramDelivery.create({
      data: {
        connectionId: connection.id,
        subscriptionId: sub.id,
        eventType: 'page.created',
        eventId: randomUUID(),
        payload: { version: 1 } as Prisma.InputJsonObject,
      },
    })
    await prisma.telegramBotCommandAudit.create({
      data: {
        connectionId: connection.id,
        chatId: '100',
        telegramUserId: '555',
        command: 'search',
        result: 'OK',
      },
    })

    const shapes = [
      await caller.getConnection({ workspaceId: ws.id }),
      await caller.listChats({ workspaceId: ws.id }),
      await caller.listSubscriptions({ workspaceId: ws.id }),
      await caller.deliveries({ workspaceId: ws.id }),
      await caller.auditLog({ workspaceId: ws.id }),
    ]
    for (const shape of shapes) {
      const json = JSON.stringify(shape)
      expect(json).not.toContain(GOOD_TOKEN)
      expect(json).not.toContain(secret)
      expect(json).not.toContain('botTokenEnc')
      expect(json).not.toContain('webhookSecretEnc')
    }
    expect(shapes[0]).toMatchObject({ status: 'ACTIVE', botUsername: 'anynote_bot' })
  })

  it('verify re-runs getMe+setWebhook and reactivates an ERROR connection', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    // No connection yet → NOT_FOUND.
    await expect(caller.verify({ workspaceId: ws.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    telegramApiMock.getMe.mockResolvedValue({ ok: false, description: 'Unauthorized' })
    await caller.connect({ workspaceId: ws.id, botToken: GOOD_TOKEN }) // → ERROR

    telegramApiMock.getMe.mockResolvedValue({
      ok: true,
      result: { id: 42, username: 'anynote_bot' },
    })
    telegramApiMock.setWebhook.mockResolvedValue({ ok: true, result: true })
    const res = await caller.verify({ workspaceId: ws.id })
    expect(res.status).toBe('ACTIVE')
    const row = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(row.status).toBe('ACTIVE')
    expect(row.botUsername).toBe('anynote_bot')
    expect(row.consecutiveFailures).toBe(0)
    expect(row.lastError).toBeNull()
    // The handshake used the STORED token (decrypted), not a fresh input.
    expect(telegramApiMock.constructed.at(-1)).toMatchObject({ token: GOOD_TOKEN })

    // A DISABLED connection is not verifiable — reconnect instead.
    await prisma.telegramConnection.update({
      where: { id: row.id },
      data: { status: 'DISABLED' },
    })
    await expect(caller.verify({ workspaceId: ws.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('disconnect disables the connection, best-effort deletes the webhook and skips pending deliveries', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const chat = await makeChat(connection.id, '100')
    const team = await makeCollection(ws.id, 'TEAM', 'Команда')
    const sub = await caller.createSubscription({
      workspaceId: ws.id,
      chatId: chat.id,
      collectionId: team.id,
      events: ['page.created'],
    })
    await prisma.telegramDelivery.createMany({
      data: [
        {
          connectionId: connection.id,
          subscriptionId: sub.id,
          eventType: 'page.created',
          eventId: randomUUID(),
          payload: { version: 1 } as Prisma.InputJsonObject,
          status: 'PENDING',
        },
        {
          connectionId: connection.id,
          subscriptionId: sub.id,
          eventType: 'page.created',
          eventId: randomUUID(),
          payload: { version: 1 } as Prisma.InputJsonObject,
          status: 'SENT',
        },
      ],
    })

    // deleteWebhook failing must NOT block the disconnect (best-effort).
    telegramApiMock.deleteWebhook.mockRejectedValue(new Error('network down'))
    const res = await caller.disconnect({ workspaceId: ws.id })
    expect(res.status).toBe('DISABLED')
    expect(telegramApiMock.deleteWebhook).toHaveBeenCalledTimes(1)
    const statuses = await prisma.telegramDelivery.findMany({
      where: { connectionId: connection.id },
      select: { status: true },
      orderBy: { status: 'asc' },
    })
    expect(statuses.map((d) => d.status).sort()).toEqual(['SENT', 'SKIPPED'])
  })

  it('deliveries paginates by 30, omits the payload and is workspace-scoped', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const chat = await makeChat(connection.id, '100')
    const team = await makeCollection(ws.id, 'TEAM', 'Команда')
    const sub = await caller.createSubscription({
      workspaceId: ws.id,
      chatId: chat.id,
      collectionId: team.id,
      events: ['page.created'],
    })
    const base = Date.now()
    await prisma.telegramDelivery.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        connectionId: connection.id,
        subscriptionId: sub.id,
        eventType: 'page.created',
        eventId: randomUUID(),
        payload: { version: 1, secretish: 'never-shown' } as Prisma.InputJsonObject,
        createdAt: new Date(base - i * 1000),
      })),
    })

    const page1 = await caller.deliveries({ workspaceId: ws.id })
    expect(page1.items.length).toBe(30)
    expect(page1.nextCursor).not.toBeNull()
    expect(page1.items[0]).not.toHaveProperty('payload')
    expect(JSON.stringify(page1)).not.toContain('never-shown')

    const page2 = await caller.deliveries({ workspaceId: ws.id, cursor: page1.nextCursor! })
    expect(page2.items.length).toBe(5)
    expect(page2.nextCursor).toBeNull()
    const ids = new Set([...page1.items, ...page2.items].map((d) => d.id))
    expect(ids.size).toBe(35)

    // Foreign workspace (owner-managed, plan flag on, NO connection) → NOT_FOUND.
    const otherWs = await prisma.workspace.create({
      data: { name: 'OtherWS', createdById: owner.id },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: otherWs.id, userId: owner.id, role: 'OWNER' },
    })
    await expect(caller.deliveries({ workspaceId: otherWs.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('auditLog paginates by 30 and is workspace-scoped', async () => {
    const { owner, ws } = await seed()
    const caller = makeCaller(owner.id)
    await connectActive(caller, ws.id)
    const connection = await prisma.telegramConnection.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    const base = Date.now()
    await prisma.telegramBotCommandAudit.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        connectionId: connection.id,
        chatId: '100',
        telegramUserId: '555',
        command: 'search',
        argsSummary: `query-${i}`,
        result: 'OK' as const,
        createdAt: new Date(base - i * 1000),
      })),
    })

    const page1 = await caller.auditLog({ workspaceId: ws.id })
    expect(page1.items.length).toBe(30)
    expect(page1.nextCursor).not.toBeNull()
    expect(page1.items[0]).toMatchObject({ command: 'search', result: 'OK' })

    const page2 = await caller.auditLog({ workspaceId: ws.id, cursor: page1.nextCursor! })
    expect(page2.items.length).toBe(5)
    expect(page2.nextCursor).toBeNull()

    const otherWs = await prisma.workspace.create({
      data: { name: 'OtherWS', createdById: owner.id },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: otherWs.id, userId: owner.id, role: 'OWNER' },
    })
    await expect(caller.auditLog({ workspaceId: otherWs.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('createLinkCode is member-level, returns the plaintext once and invalidates prior codes', async () => {
    const { editor } = await seed()
    // EDITOR (forbidden on every managed proc) can mint a link code.
    const caller = makeCaller(editor.id)
    const first = await caller.createLinkCode()
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    // 15-minute TTL window (with a minute of slack for slow CI).
    const ttl = first.expiresAt.getTime() - Date.now()
    expect(ttl).toBeGreaterThan(14 * 60_000)
    expect(ttl).toBeLessThanOrEqual(15 * 60_000)

    const rows = await prisma.telegramLinkCode.findMany({ where: { userId: editor.id } })
    expect(rows).toHaveLength(1)
    // Hashed at rest — the plaintext appears nowhere in the row.
    expect(rows[0]!.codeHash).toBe(hashLinkCode(first.code))
    expect(JSON.stringify(rows)).not.toContain(first.code)
    expect(rows[0]!.usedAt).toBeNull()

    // A second code invalidates the first (marked used, kept for the trail).
    const second = await caller.createLinkCode()
    expect(second.code).not.toBe(first.code)
    const firstRow = await prisma.telegramLinkCode.findUniqueOrThrow({
      where: { codeHash: hashLinkCode(first.code) },
    })
    expect(firstRow.usedAt).not.toBeNull()
    const secondRow = await prisma.telegramLinkCode.findUniqueOrThrow({
      where: { codeHash: hashLinkCode(second.code) },
    })
    expect(secondRow.usedAt).toBeNull()
  })

  it('createLinkCode works on a personal plan too (no plan gate)', async () => {
    await ensurePersonalPlan()
    const freeUser = await makeUser('free-link')
    const res = await makeCaller(freeUser.id).createLinkCode()
    expect(res.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  })

  it('getMyLink / unlinkMe report and clear the user link', async () => {
    const { editor } = await seed()
    const caller = makeCaller(editor.id)
    expect(await caller.getMyLink()).toBeNull()

    await prisma.telegramUserLink.create({
      data: { userId: editor.id, telegramUserId: '777', username: 'editor_tg' },
    })
    const link = await caller.getMyLink()
    expect(link).toMatchObject({ username: 'editor_tg' })
    expect(link!.linkedAt).toBeInstanceOf(Date)

    await caller.unlinkMe()
    expect(await caller.getMyLink()).toBeNull()
    expect(await prisma.telegramUserLink.count({ where: { userId: editor.id } })).toBe(0)
  })
})
