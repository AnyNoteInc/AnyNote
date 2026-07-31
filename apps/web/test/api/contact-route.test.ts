import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POST } from '@/app/api/contact/route'

const APP_ORIGIN = 'http://localhost:3000'
const BOT_TOKEN = 'bot-token'
const CHAT_ID = '-100123'

const validPayload = {
  name: 'Ирина',
  company: 'Acme',
  email: 'irina@example.com',
  phone: '+7 900 000-00-00',
  message: 'Нужен SSO',
  consentPersonalData: true,
  consentMarketing: true,
}

function successResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>(async () => successResponse())

vi.stubGlobal('fetch', fetchMock)

let testIp = '203.0.113.1'
let testIpSequence = 0

function callRoute(
  payload: unknown = validPayload,
  options: { origin?: string | null; ip?: string } = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': options.ip ?? testIp,
  }
  if (options.origin !== null) headers.origin = options.origin ?? APP_ORIGIN

  const req = new Request(`${APP_ORIGIN}/api/contact`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }) as unknown as NextRequest
  return POST(req)
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', APP_ORIGIN)
  vi.stubEnv('TELEGRAM_API_BASE_URL', 'https://api.telegram.org')
  vi.stubEnv('TELEGRAM_BOT_TOKEN', BOT_TOKEN)
  vi.stubEnv('TELEGRAM_CHAT_ID', CHAT_ID)
  testIpSequence += 1
  testIp = `203.0.113.${testIpSequence}`
  fetchMock.mockClear().mockImplementation(async () => successResponse())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('POST /api/contact — Telegram delivery', () => {
  it('sends a valid request to the configured chat and escapes Telegram HTML', async () => {
    const res = await callRoute({
      ...validPayload,
      name: '<Ирина>',
      company: 'Acme & Co',
      message: '<b>нужен SSO</b>',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)
    const telegramBody = JSON.parse(String(init.body)) as { chat_id: string; text: string }
    expect(telegramBody.chat_id).toBe(CHAT_ID)
    expect(telegramBody.text).toContain('&lt;Ирина&gt;')
    expect(telegramBody.text).not.toContain('<Ирина>')
    expect(telegramBody.text).toContain('&lt;b&gt;нужен SSO&lt;/b&gt;')
  })

  it('rejects invalid data without calling Telegram', async () => {
    const res = await callRoute({
      ...validPayload,
      name: '',
      email: 'not-an-email',
      phone: '',
      consentMarketing: false,
    })

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects overlong input without calling Telegram', async () => {
    const res = await callRoute({ ...validPayload, message: 'x'.repeat(2001) })

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin request before contacting Telegram', async () => {
    const res = await callRoute(validPayload, { origin: 'https://evil.example' })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a request without an origin before contacting Telegram', async () => {
    const res = await callRoute(validPayload, { origin: null })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 503 when Telegram configuration is missing', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')

    const res = await callRoute()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Сервис заявок временно недоступен.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a neutral 502 when Telegram rejects the message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await callRoute()

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toEqual({ error: 'Не удалось отправить заявку. Попробуйте ещё раз.' })
    expect(JSON.stringify(body)).not.toContain(BOT_TOKEN)
  })

  it('returns 502 when the Telegram request fails unexpectedly', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const res = await callRoute()

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'Не удалось отправить заявку. Попробуйте ещё раз.',
    })
  })
})

describe('POST /api/contact — per-IP rate limit', () => {
  it('returns 429 on the sixth request and allows another IP', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await callRoute()).status).toBe(200)
    }

    expect((await callRoute()).status).toBe(429)
    expect((await callRoute(validPayload, { ip: '198.51.100.2' })).status).toBe(200)

    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    expect((await callRoute()).status).toBe(200)
  })
})
