import { timingSafeEqual } from 'node:crypto'

import { NextRequest, NextResponse } from 'next/server'
import { decryptSecret, type EncryptedPayload } from '@repo/auth'
import { prisma } from '@repo/db'
import { TelegramApi, routeUpdate, type TelegramUpdate } from '@repo/telegram'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type InboundChat = { id: number | string; type?: string; title?: string }

/** `TelegramUpdate` narrows `my_chat_member` to `unknown`; refine it here. */
type InboundUpdate = TelegramUpdate & {
  my_chat_member?: {
    chat?: InboundChat
    new_chat_member?: { status?: string }
  }
}

/**
 * Timing-safe comparison of the inbound `X-Telegram-Bot-Api-Secret-Token`
 * against the decrypted stored secret. An undecryptable secret (key rotation,
 * corruption) matches nothing — the caller answers 403 either way. The length
 * guard is required (`timingSafeEqual` throws on mismatch) and leaks nothing:
 * the secret's length is not secret.
 */
function verifySecret(header: string | null, secretEnc: unknown): boolean {
  let expected: string
  try {
    expected = decryptSecret(secretEnc as EncryptedPayload)
  } catch {
    return false
  }
  const provided = Buffer.from(header ?? '', 'utf8')
  const wanted = Buffer.from(expected, 'utf8')
  if (provided.length !== wanted.length) return false
  return timingSafeEqual(provided, wanted)
}

/**
 * Bot-membership → chat-registry status. Anything else (e.g. `restricted`)
 * leaves the registry untouched.
 */
function chatStatusFor(memberStatus: string | undefined): 'ACTIVE' | 'LEFT' | null {
  if (memberStatus === 'left' || memberStatus === 'kicked') return 'LEFT'
  if (memberStatus === 'member' || memberStatus === 'administrator') return 'ACTIVE'
  return null
}

async function upsertChat(
  connectionId: string,
  chat: InboundChat,
  status: 'ACTIVE' | 'LEFT',
): Promise<void> {
  const data = {
    type: (chat.type ?? 'private').slice(0, 16),
    title: chat.title?.slice(0, 255) ?? null,
    status,
  }
  await prisma.telegramChat.upsert({
    where: { connectionId_chatId: { connectionId, chatId: String(chat.id) } },
    create: { connectionId, chatId: String(chat.id), ...data },
    update: data,
  })
}

/** Best-effort reply: failures are swallowed and logged, never surfaced to Telegram. */
async function sendReply(botTokenEnc: unknown, chatId: string, text: string): Promise<void> {
  try {
    const token = decryptSecret(botTokenEnc as EncryptedPayload)
    const result = await new TelegramApi(token).sendMessage(chatId, text)
    if (!result.ok) {
      console.warn('[telegram] reply send failed', { chatId, description: result.description })
    }
  } catch (err) {
    // `err.name` only — never the message (could embed secrets-adjacent state).
    console.warn('[telegram] reply send failed', {
      chatId,
      description: err instanceof Error ? err.name : 'error',
    })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params
  if (!UUID_RE.test(connectionId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const connection = await prisma.telegramConnection.findUnique({ where: { id: connectionId } })
  if (connection === null || connection.status === 'DISABLED') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const secretHeader = req.headers.get('x-telegram-bot-api-secret-token')
  if (!verifySecret(secretHeader, connection.webhookSecretEnc)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let update: InboundUpdate
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    update = parsed as InboundUpdate
  } catch {
    return NextResponse.json({ error: 'bad update' }, { status: 400 })
  }

  // Chat registry: the bot being added/removed from a chat.
  const membership = update.my_chat_member
  if (membership?.chat?.id !== undefined) {
    const status = chatStatusFor(membership.new_chat_member?.status)
    if (status !== null) await upsertChat(connection.id, membership.chat, status)
    return NextResponse.json({ ok: true })
  }

  // Messages: register the chat as ACTIVE, then dispatch commands.
  const message = update.message
  if (message?.chat?.id !== undefined) {
    await upsertChat(connection.id, message.chat, 'ACTIVE')
    if (message.from !== undefined && (message.text ?? '').trim().startsWith('/')) {
      const { reply, audit } = await routeUpdate(
        prisma,
        { id: connection.id, workspaceId: connection.workspaceId },
        update,
      )
      if (audit !== null) {
        await prisma.telegramBotCommandAudit.create({
          data: { connectionId: connection.id, ...audit },
        })
      }
      if (reply !== null) {
        await sendReply(connection.botTokenEnc, String(message.chat.id), reply)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
