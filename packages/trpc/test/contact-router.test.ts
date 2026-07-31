import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

vi.mock('@repo/db', () => ({
  prisma: {},
}))

import type { PrismaClient } from '@repo/db'

import { contactRouter, resetContactRateLimit } from '../src/routers/contact'
import { createCallerFactory } from '../src/trpc'

const createCaller = createCallerFactory(contactRouter)

const APP_ORIGIN = 'http://localhost:3000'
const BOT_TOKEN = 'bot-token'
const CHAT_ID = '-100123'

const validPayload = {
  name: 'Ирина',
  company: 'Acme',
  email: 'irina@example.com',
  phone: '+7 900 000-00-00',
  message: 'Нужен SSO',
  consentPersonalData: true as const,
  consentMarketing: true as const,
}

function successResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()
let testIp = '203.0.113.1'
let testIpSequence = 0

function makeCaller(options: { origin?: string | null; ip?: string } = {}) {
  const headers = new Headers({
    host: 'localhost:3000',
    'x-forwarded-proto': 'http',
    'x-forwarded-for': options.ip ?? testIp,
  })
  if (options.origin !== null) headers.set('origin', options.origin ?? APP_ORIGIN)

  return createCaller({
    prisma: {} as PrismaClient,
    user: null,
    headers,
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: APP_ORIGIN,
    jobs: { kick: vi.fn() },
  })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', APP_ORIGIN)
  vi.stubEnv('BETTER_AUTH_URL', APP_ORIGIN)
  vi.stubEnv('TELEGRAM_API_BASE_URL', 'https://api.telegram.org')
  vi.stubEnv('TELEGRAM_BOT_TOKEN', BOT_TOKEN)
  vi.stubEnv('TELEGRAM_CHAT_ID', CHAT_ID)
  testIpSequence += 1
  testIp = `203.0.113.${testIpSequence}`
  resetContactRateLimit()
  fetchMock.mockReset().mockImplementation(async () => successResponse())
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('contactRouter.submit', () => {
  it('delivers valid input and escapes Telegram HTML', async () => {
    const caller = makeCaller()
    const result = await caller.submit({
      ...validPayload,
      name: '<Ирина>',
      company: 'Acme & Co',
      message: '<b>нужен SSO</b>',
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)
    const body = JSON.parse(String(init.body)) as { chat_id: string; text: string }
    expect(body.chat_id).toBe(CHAT_ID)
    expect(body.text).toContain('&lt;Ирина&gt;')
    expect(body.text).not.toContain('<Ирина>')
    expect(body.text).toContain('&lt;b&gt;нужен SSO&lt;/b&gt;')
  })

  it('rejects invalid data without contacting Telegram', async () => {
    const caller = makeCaller()

    await expect(
      caller.submit({
        ...validPayload,
        name: '',
        email: 'not-an-email',
        phone: '',
        consentMarketing: false,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects overlong input without contacting Telegram', async () => {
    const caller = makeCaller()

    await expect(caller.submit({ ...validPayload, message: 'x'.repeat(2001) })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin request before contacting Telegram', async () => {
    const caller = makeCaller({ origin: 'https://evil.example' })

    await expect(caller.submit(validPayload)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Недопустимый источник запроса',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a request without an origin before contacting Telegram', async () => {
    const caller = makeCaller({ origin: null })

    await expect(caller.submit(validPayload)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Недопустимый источник запроса',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a safe configuration error when Telegram variables are missing', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '')
    const caller = makeCaller()

    await expect(caller.submit(validPayload)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Сервис заявок временно недоступен.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a neutral error when Telegram rejects the message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const caller = makeCaller()

    const error = await caller.submit(validPayload).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'BAD_GATEWAY',
      message: 'Не удалось отправить заявку. Попробуйте ещё раз.',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.stringify(error)).not.toContain(BOT_TOKEN)
  })

  it('returns a neutral error when the Telegram request fails unexpectedly', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const caller = makeCaller()

    await expect(caller.submit(validPayload)).rejects.toMatchObject({
      code: 'BAD_GATEWAY',
      message: 'Не удалось отправить заявку. Попробуйте ещё раз.',
    })
  })
})

describe('contactRouter.submit rate limit', () => {
  it('limits one IP to five requests per ten minutes and allows another IP', async () => {
    const caller = makeCaller()

    for (let index = 0; index < 5; index += 1) {
      await expect(caller.submit(validPayload)).resolves.toEqual({ ok: true })
    }

    await expect(caller.submit(validPayload)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'Слишком много заявок. Попробуйте позже.',
    })
    await expect(makeCaller({ ip: '198.51.100.2' }).submit(validPayload)).resolves.toEqual({
      ok: true,
    })

    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    await expect(caller.submit(validPayload)).resolves.toEqual({ ok: true })
  })
})
