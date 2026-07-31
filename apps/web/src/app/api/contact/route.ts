import { NextRequest, NextResponse } from 'next/server'
import { TelegramApi, escapeHtml } from '@repo/telegram'
import { z } from 'zod'

export const runtime = 'nodejs'

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 10 * 60_000

const requestLog = new Map<string, number[]>()

const ContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    company: z.string().trim().max(200).default(''),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().min(1).max(50),
    message: z.string().trim().max(2000).default(''),
    consentPersonalData: z.literal(true),
    consentMarketing: z.literal(true),
  })
  .strict()

type ContactRequest = z.infer<typeof ContactSchema>

function clientIpOf(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  const firstHop = forwarded?.split(',')[0]?.trim()
  return firstHop || req.headers.get('x-real-ip') || 'unknown'
}

function isSameAppOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false

  const base = process.env.NEXT_PUBLIC_BASE_URL
  try {
    const expected = base
      ? new URL(base).origin
      : new URL(`${new URL(req.url).protocol}//${req.headers.get('host') ?? ''}`).origin
    return new URL(origin).origin === expected
  } catch {
    return false
  }
}

function isRateLimited(ip: string): boolean {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS
  const recent = (requestLog.get(ip) ?? []).filter((timestamp) => timestamp > cutoff)
  if (recent.length >= RATE_LIMIT_MAX) {
    requestLog.set(ip, recent)
    return true
  }

  recent.push(Date.now())
  requestLog.set(ip, recent)
  return false
}

function optionalValue(value: string): string {
  return value || '—'
}

function renderContactMessage(contact: ContactRequest): string {
  return [
    '📩 <b>Новая заявка с сайта AnyNote</b>',
    '',
    `<b>Имя:</b> ${escapeHtml(contact.name)}`,
    `<b>Компания:</b> ${escapeHtml(optionalValue(contact.company))}`,
    `<b>Телефон:</b> ${escapeHtml(contact.phone)}`,
    `<b>Email:</b> ${escapeHtml(contact.email)}`,
    `<b>Что нужно:</b>\n${escapeHtml(optionalValue(contact.message))}`,
    '',
    `Отправлено: ${new Date().toISOString()}`,
  ].join('\n')
}

export const __testHooks = {
  resetRateLimit(): void {
    requestLog.clear()
  },
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameAppOrigin(req)) {
    return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  }

  if (isRateLimited(clientIpOf(req))) {
    return NextResponse.json(
      { error: 'Слишком много заявок. Попробуйте позже.' },
      { status: 429 },
    )
  }

  const parsed = ContactSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Некорректные данные заявки.' }, { status: 400 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  if (!token || !chatId) {
    return NextResponse.json(
      { error: 'Сервис заявок временно недоступен.' },
      { status: 503 },
    )
  }

  try {
    const result = await new TelegramApi(token).sendMessage(chatId, renderContactMessage(parsed.data))
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Не удалось отправить заявку. Попробуйте ещё раз.' },
        { status: 502 },
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Не удалось отправить заявку. Попробуйте ещё раз.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
