import { randomUUID } from 'node:crypto'

import { encryptSecret } from '@repo/auth'
import { prisma } from '@repo/db'
import type { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '@/app/api/telegram/webhook/[connectionId]/route'

const EMAIL_SUFFIX = '+tg-webhook-route-test@anynote.dev'
const WEBHOOK_SECRET = 'tg-webhook-secret-0123456789abcdef'
const BOT_TOKEN = '123456789:AA-test-bot-token-aaaaaaaaaaaaaaaaaaa'

// Reply seam: the route constructs `TelegramApi` internally, and `TelegramApi`
// resolves `opts.fetchFn ?? fetch` at call time — so stubbing the GLOBAL fetch
// intercepts the outbound `sendMessage` without mocking any module. The real
// `TelegramApi` code runs; prisma talks over pg (not fetch), so this is safe.
const fetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      headers: { 'content-type': 'application/json' },
    }),
)
vi.stubGlobal('fetch', fetchMock)

afterAll(() => {
  vi.unstubAllGlobals()
})

async function cleanFixtures() {
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seedConnection() {
  const user = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'TG',
      firstName: 'TG',
      lastName: 'Route',
    },
  })
  const workspace = await prisma.workspace.create({
    data: { name: 'TG Route WS', createdById: user.id },
  })
  const connection = await prisma.telegramConnection.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      botTokenEnc: encryptSecret(BOT_TOKEN),
      webhookSecretEnc: encryptSecret(WEBHOOK_SECRET),
      status: 'ACTIVE',
    },
  })
  return connection
}

function callRoute(connectionId: string, body: string, secret: string | null = WEBHOOK_SECRET) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (secret !== null) headers['x-telegram-bot-api-secret-token'] = secret
  const req = new Request(`http://localhost:3000/api/telegram/webhook/${connectionId}`, {
    method: 'POST',
    headers,
    body,
  }) as unknown as NextRequest
  return POST(req, { params: Promise.resolve({ connectionId }) })
}

const joinUpdate = JSON.stringify({
  my_chat_member: {
    chat: { id: -100123, type: 'supergroup', title: 'Team chat' },
    new_chat_member: { status: 'member' },
  },
})

const kickedUpdate = JSON.stringify({
  my_chat_member: {
    chat: { id: -100123, type: 'supergroup', title: 'Team chat' },
    new_chat_member: { status: 'kicked' },
  },
})

const helpUpdate = JSON.stringify({
  message: {
    chat: { id: 555, type: 'private' },
    from: { id: 777, username: 'tester' },
    text: '/help',
  },
})

describe('POST /api/telegram/webhook/[connectionId]', () => {
  beforeEach(async () => {
    await cleanFixtures()
    fetchMock.mockClear()
  })

  it('returns 403 on secret mismatch and creates no chat row', async () => {
    const connection = await seedConnection()
    const res = await callRoute(connection.id, joinUpdate, 'wrong-secret')
    expect(res.status).toBe(403)
    const missing = await callRoute(connection.id, joinUpdate, null)
    expect(missing.status).toBe(403)
    const chats = await prisma.telegramChat.findMany({ where: { connectionId: connection.id } })
    expect(chats).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the stored secret cannot be decrypted', async () => {
    const connection = await seedConnection()
    await prisma.telegramConnection.update({
      where: { id: connection.id },
      data: { webhookSecretEnc: { iv: 'xx', ciphertext: 'xx', tag: 'xx' } },
    })
    const res = await callRoute(connection.id, joinUpdate)
    expect(res.status).toBe(403)
  })

  it('upserts an ACTIVE chat on my_chat_member join', async () => {
    const connection = await seedConnection()
    const res = await callRoute(connection.id, joinUpdate)
    expect(res.status).toBe(200)
    const chat = await prisma.telegramChat.findUnique({
      where: { connectionId_chatId: { connectionId: connection.id, chatId: '-100123' } },
    })
    expect(chat?.status).toBe('ACTIVE')
    expect(chat?.type).toBe('supergroup')
    expect(chat?.title).toBe('Team chat')
  })

  it('marks the chat LEFT when the bot is kicked', async () => {
    const connection = await seedConnection()
    await callRoute(connection.id, joinUpdate)
    const res = await callRoute(connection.id, kickedUpdate)
    expect(res.status).toBe(200)
    const chat = await prisma.telegramChat.findUnique({
      where: { connectionId_chatId: { connectionId: connection.id, chatId: '-100123' } },
    })
    expect(chat?.status).toBe('LEFT')
  })

  it('audits a /help command, replies via the bot api, and returns 200', async () => {
    const connection = await seedConnection()
    const res = await callRoute(connection.id, helpUpdate)
    expect(res.status).toBe(200)

    const audits = await prisma.telegramBotCommandAudit.findMany({
      where: { connectionId: connection.id },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      command: 'help',
      result: 'OK',
      telegramUserId: '777',
      chatId: '555',
      linkedUserId: null,
    })

    // The message chat is registered ACTIVE before dispatch.
    const chat = await prisma.telegramChat.findUnique({
      where: { connectionId_chatId: { connectionId: connection.id, chatId: '555' } },
    })
    expect(chat?.status).toBe('ACTIVE')

    // Best-effort reply went out through the real TelegramApi with the decrypted token.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain(`/bot${BOT_TOKEN}/sendMessage`)
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '555' })
  })

  it('still returns 200 when the reply send fails', async () => {
    const connection = await seedConnection()
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const res = await callRoute(connection.id, helpUpdate)
    expect(res.status).toBe(200)
    const audits = await prisma.telegramBotCommandAudit.count({
      where: { connectionId: connection.id },
    })
    expect(audits).toBe(1)
  })

  it('returns 404 for a DISABLED connection', async () => {
    const connection = await seedConnection()
    await prisma.telegramConnection.update({
      where: { id: connection.id },
      data: { status: 'DISABLED' },
    })
    const res = await callRoute(connection.id, joinUpdate)
    expect(res.status).toBe(404)
  })

  it('returns 404 for an unknown or malformed connection id', async () => {
    const unknown = await callRoute(randomUUID(), joinUpdate)
    expect(unknown.status).toBe(404)
    const malformed = await callRoute('not-a-uuid', joinUpdate)
    expect(malformed.status).toBe(404)
  })

  it('returns 400 on a non-JSON body', async () => {
    const connection = await seedConnection()
    const res = await callRoute(connection.id, '{nope')
    expect(res.status).toBe(400)
  })
})
