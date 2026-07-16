import { describe, expect, it, vi } from 'vitest'

import { verifyFormCaptcha } from '../src/helpers/form-captcha'

const SECRET = 'recaptcha-test-secret'
const TOKEN = 'browser-recaptcha-token'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function success(action: 'form_submit' | 'form_upload', score = 0.9, hostname = 'anynote.ru') {
  return { success: true, action, score, hostname }
}

describe('form CAPTCHA verification', () => {
  it.each(['form_submit', 'form_upload'] as const)(
    'posts the token, client IP, and secret for action %s',
    async (action) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(success(action)))
      const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' })

      await verifyFormCaptcha({ token: TOKEN, action, headers, fetchImpl, secret: SECRET })

      expect(fetchImpl).toHaveBeenCalledOnce()
      const [url, init] = fetchImpl.mock.calls[0]!
      expect(url).toBe('https://www.google.com/recaptcha/api/siteverify')
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      expect(new URLSearchParams(String(init?.body))).toEqual(
        new URLSearchParams({ secret: SECRET, response: TOKEN, remoteip: '203.0.113.7' }),
      )
    },
  )

  it('accepts the minimum score of 0.5', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(success('form_submit', 0.5)))

    await expect(
      verifyFormCaptcha({
        token: TOKEN,
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: SECRET,
      }),
    ).resolves.toBeUndefined()
  })

  it.each([
    [success('form_submit', 0.49), 'low score'],
    [success('form_upload'), 'wrong action'],
    [{ success: false, action: 'form_submit', score: 0.9 }, 'upstream rejection'],
  ])('fails closed for %s (%s)', async (result) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(result))

    await expect(
      verifyFormCaptcha({
        token: TOKEN,
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: SECRET,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
  })

  it('requires the configured production hostname', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(success('form_submit', 0.9, 'attacker.example')))

    await expect(
      verifyFormCaptcha({
        token: TOKEN,
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: SECRET,
        nodeEnv: 'production',
        betterAuthUrl: 'https://anynote.ru',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
  })

  it('accepts a matching production hostname', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(success('form_submit', 0.9, 'anynote.ru')))

    await expect(
      verifyFormCaptcha({
        token: TOKEN,
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: SECRET,
        nodeEnv: 'production',
        betterAuthUrl: 'https://anynote.ru/some-path',
      }),
    ).resolves.toBeUndefined()
  })

  it('fails closed on an upstream non-2xx response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({}, 503))

    await expect(
      verifyFormCaptcha({
        token: TOKEN,
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: SECRET,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
  })

  it('fails closed when the production secret is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyFormCaptcha({
        token: TOKEN,
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: '',
        nodeEnv: 'production',
        betterAuthUrl: 'https://anynote.ru',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows local development without a configured secret', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyFormCaptcha({
        token: null,
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: '',
        nodeEnv: 'development',
      }),
    ).resolves.toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a missing browser token when CAPTCHA is configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>()

    await expect(
      verifyFormCaptcha({
        token: null,
        action: 'form_submit',
        headers: new Headers(),
        fetchImpl,
        secret: SECRET,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'FORM_CAPTCHA_FAILED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
