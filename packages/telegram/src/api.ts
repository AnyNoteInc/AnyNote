export type TelegramApiResult<T> = { ok: true; result: T } | { ok: false; description: string }

/**
 * Minimal Telegram Bot API client. Fixed host (`TELEGRAM_API_BASE_URL` /
 * api.telegram.org) — no user-controlled URLs, no SSRF surface. The token is
 * embedded in the request URL per the Bot API contract, so error surfaces are
 * restricted to `err.name` (never the message/URL) to keep it out of logs and
 * `lastError` strings.
 */
export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly opts: { fetchFn?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
  ) {}

  private get baseUrl(): string {
    return this.opts.baseUrl ?? process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org'
  }

  private async call<T>(
    method: string,
    body?: Record<string, unknown>,
  ): Promise<TelegramApiResult<T>> {
    const fetchFn = this.opts.fetchFn ?? fetch
    const timeoutMs = this.opts.timeoutMs ?? Number(process.env.TELEGRAM_TIMEOUT_MS ?? 10_000)
    try {
      const res = await fetchFn(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      let json: { ok: boolean; result?: T; description?: string }
      try {
        json = (await res.json()) as { ok: boolean; result?: T; description?: string }
      } catch {
        // Non-JSON body (proxy / HTML error page): surface the status only —
        // never the body and never the URL (it embeds the token).
        return { ok: false, description: `HTTP ${res.status}` }
      }
      if (!json.ok) return { ok: false, description: json.description ?? `HTTP ${res.status}` }
      return { ok: true, result: json.result as T }
    } catch (err) {
      // Never include the URL (it embeds the token) in surfaced errors.
      return { ok: false, description: err instanceof Error ? err.name : 'fetch failed' }
    }
  }

  getMe() {
    return this.call<{ id: number; username?: string }>('getMe')
  }

  setWebhook(url: string, secretToken: string) {
    return this.call<boolean>('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'my_chat_member'],
    })
  }

  deleteWebhook() {
    return this.call<boolean>('deleteWebhook')
  }

  sendMessage(chatId: string, text: string) {
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
  }
}
