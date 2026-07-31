import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { TelegramApi, escapeHtml } from '@repo/telegram'

import { publicProcedure, router } from '../trpc'

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 10 * 60_000

const requestLog = new Map<string, number[]>()

const contactInputSchema = z
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

type ContactInput = z.infer<typeof contactInputSchema>

const CONTACT_ORIGIN_ERROR = 'Недопустимый источник запроса'
const CONFIG_ERROR = 'Сервис заявок временно недоступен.'
const DELIVERY_ERROR = 'Не удалось отправить заявку. Попробуйте ещё раз.'

export function resetContactRateLimit(): void {
  requestLog.clear()
}

function clientIpOf(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip')?.trim() ??
    'unknown'
  )
}

function expectedOrigin(headers: Headers): string | null {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim()
  if (configuredBaseUrl) {
    try {
      return new URL(configuredBaseUrl).origin
    } catch {
      return null
    }
  }

  const host = headers.get('host')
  if (!host) return null
  const protocol = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'http'
  try {
    return new URL(`${protocol}://${host}`).origin
  } catch {
    return null
  }
}

function isSameAppOrigin(headers: Headers): boolean {
  const origin = headers.get('origin')
  const expected = expectedOrigin(headers)
  if (!origin || !expected) return false

  try {
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

function renderContactMessage(contact: ContactInput): string {
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

export const contactRouter = router({
  submit: publicProcedure.input(contactInputSchema).mutation(async ({ ctx, input }) => {
    ctx.resHeaders.set('Cache-Control', 'private, no-store')

    if (!isSameAppOrigin(ctx.headers)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: CONTACT_ORIGIN_ERROR })
    }

    if (isRateLimited(clientIpOf(ctx.headers))) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Слишком много заявок. Попробуйте позже.',
      })
    }

    const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
    if (!token || !chatId) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: CONFIG_ERROR })
    }

    try {
      const result = await new TelegramApi(token).sendMessage(chatId, renderContactMessage(input))
      if (!result.ok) throw new Error('Telegram rejected the message')
    } catch {
      throw new TRPCError({ code: 'BAD_GATEWAY', message: DELIVERY_ERROR })
    }

    return { ok: true as const }
  }),
})
