import { describe, expect, it } from 'vitest'

import { TelegramApi } from '../src/api.ts'

const TOKEN = '123456789:AAFakeTokenForTests_abcdefghij'

type Captured = { url: string; init: RequestInit | undefined }

function capturingFetch(response: { ok: boolean; result?: unknown; description?: string }, status = 200) {
  const calls: Captured[] = []
  const fetchFn: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init })
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return { calls, fetchFn }
}

describe('TelegramApi URL composition', () => {
  it('builds {base}/bot{token}/{method} from an explicit baseUrl', async () => {
    const { calls, fetchFn } = capturingFetch({ ok: true, result: { id: 1 } })
    const api = new TelegramApi(TOKEN, { fetchFn, baseUrl: 'https://tg.example' })
    await api.getMe()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`https://tg.example/bot${TOKEN}/getMe`)
  })

  it('defaults to https://api.telegram.org', async () => {
    const { calls, fetchFn } = capturingFetch({ ok: true, result: true })
    const api = new TelegramApi(TOKEN, { fetchFn })
    await api.deleteWebhook()
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`)
  })

  it('POSTs with JSON content-type', async () => {
    const { calls, fetchFn } = capturingFetch({ ok: true, result: { message_id: 5 } })
    const api = new TelegramApi(TOKEN, { fetchFn })
    await api.sendMessage('42', 'hi')
    expect(calls[0]!.init?.method).toBe('POST')
    expect((calls[0]!.init?.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    )
  })
})

describe('TelegramApi method bodies', () => {
  it('getMe sends no body and unwraps the result', async () => {
    const { calls, fetchFn } = capturingFetch({ ok: true, result: { id: 7, username: 'my_bot' } })
    const api = new TelegramApi(TOKEN, { fetchFn })
    const res = await api.getMe()
    expect(calls[0]!.init?.body).toBeUndefined()
    expect(res).toEqual({ ok: true, result: { id: 7, username: 'my_bot' } })
  })

  it('setWebhook sends url, secret_token and allowed_updates', async () => {
    const { calls, fetchFn } = capturingFetch({ ok: true, result: true })
    const api = new TelegramApi(TOKEN, { fetchFn })
    await api.setWebhook('https://app.example/api/telegram/webhook/abc', 's3cret')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      url: 'https://app.example/api/telegram/webhook/abc',
      secret_token: 's3cret',
      allowed_updates: ['message', 'my_chat_member'],
    })
  })

  it('deleteWebhook sends no body', async () => {
    const { calls, fetchFn } = capturingFetch({ ok: true, result: true })
    const api = new TelegramApi(TOKEN, { fetchFn })
    await api.deleteWebhook()
    expect(calls[0]!.url.endsWith('/deleteWebhook')).toBe(true)
    expect(calls[0]!.init?.body).toBeUndefined()
  })

  it('sendMessage sends chat_id, text, HTML parse mode and disabled preview', async () => {
    const { calls, fetchFn } = capturingFetch({ ok: true, result: { message_id: 9 } })
    const api = new TelegramApi(TOKEN, { fetchFn })
    await api.sendMessage('-100123', '<b>hi</b>')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      chat_id: '-100123',
      text: '<b>hi</b>',
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
  })
})

describe('TelegramApi error handling', () => {
  it('surfaces Telegram-level errors as { ok: false, description }', async () => {
    const { fetchFn } = capturingFetch({ ok: false, description: 'Unauthorized' }, 401)
    const api = new TelegramApi(TOKEN, { fetchFn })
    const res = await api.getMe()
    expect(res).toEqual({ ok: false, description: 'Unauthorized' })
  })

  it('falls back to HTTP status when no description is present', async () => {
    const { fetchFn } = capturingFetch({ ok: false }, 502)
    const api = new TelegramApi(TOKEN, { fetchFn })
    const res = await api.getMe()
    expect(res).toEqual({ ok: false, description: 'HTTP 502' })
  })

  it('never includes the token in error descriptions, even when fetch embeds the URL', async () => {
    const fetchFn: typeof fetch = (input) =>
      Promise.reject(new Error(`request to ${String(input)} failed`))
    const api = new TelegramApi(TOKEN, { fetchFn })
    const res = await api.sendMessage('1', 'x')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.description).not.toContain(TOKEN)
      expect(res.description).not.toContain('bot123456789')
    }
  })

  it('aborts via AbortSignal.timeout and reports TimeoutError without the token', async () => {
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(signal.reason as Error)
          return
        }
        signal?.addEventListener('abort', () => reject(signal.reason as Error))
      })
    const api = new TelegramApi(TOKEN, { fetchFn: hangingFetch, timeoutMs: 25 })
    const res = await api.getMe()
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.description).toBe('TimeoutError')
      expect(res.description).not.toContain(TOKEN)
    }
  })

  it('returns the HTTP status for non-JSON error bodies without throwing or leaking the token', async () => {
    const fetchFn: typeof fetch = () =>
      Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }))
    const api = new TelegramApi(TOKEN, { fetchFn })
    const res = await api.getMe()
    // Status only — never the body (could be huge HTML) and never the URL.
    expect(res).toEqual({ ok: false, description: 'HTTP 502' })
  })

  it('returns HTTP 403 for a non-JSON 403 body — the chat-gone signal the deliverer matches on', async () => {
    const fetchFn: typeof fetch = () =>
      Promise.resolve(new Response('<html>Forbidden</html>', { status: 403 }))
    const api = new TelegramApi(TOKEN, { fetchFn })
    const res = await api.sendMessage('1', 'x')
    expect(res).toEqual({ ok: false, description: 'HTTP 403' })
  })
})
