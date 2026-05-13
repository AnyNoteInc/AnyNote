// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- sendsay-api ships no .d.ts; the shim must follow the file when consumers compile it transitively.
/// <reference path="./sendsay-api.d.ts" />
import Sendsay from 'sendsay-api'

type SendsayClient = { request: (payload: Record<string, unknown>) => Promise<unknown> }

const FROM_EMAIL = 'noreply@anynote.ru'
const FROM_NAME = 'AnyNote'

let _client: SendsayClient | null = null

function getClient(): SendsayClient | null {
  if (_client) return _client
  const apiKey = process.env.SENDSAY_API_KEY
  if (!apiKey) return null
  const apiUrl = process.env.SENDSAY_API_URL || 'https://api.sendsay.ru'
  const Ctor = Sendsay as unknown as new (opts: { apiUrl: string; apiKey: string }) => SendsayClient
  _client = new Ctor({ apiUrl, apiKey })
  return _client
}

/** Test-only helper to reset the cached client (env changes between tests). */
export function __resetSendsayClient(): void {
  _client = null
}

export type SendEmailArgs = {
  to: string
  subject: string
  html: string
  text: string
}

type SendsayResponse = {
  errors?: Array<{ id?: string; explain?: string }>
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const client = getClient()
  if (!client) {
    console.info(
      `[mail] sendsay disabled (no SENDSAY_API_KEY); would send to ${args.to}: ${args.subject}`,
    )
    return
  }
  try {
    const response = (await client.request({
      action: 'issue.send',
      sendwhen: 'now',
      letter: {
        subject: args.subject,
        'from.name': FROM_NAME,
        'from.email': FROM_EMAIL,
        message: { html: args.html, text: args.text },
      },
      'users.list': args.to,
      // 'personal' is Sendsay's preset list id for transactional issues
      // ("Транзакционные выпуски"). The slug 'transactional' does not exist
      // and the API rejects it with wrong_arg/group.
      group: 'personal',
    })) as SendsayResponse
    if (response?.errors && response.errors.length > 0) {
      console.warn(`[mail] sendsay rejected ${args.to}: ${formatSendsayError(response.errors[0])}`)
    }
  } catch (err) {
    // sendsay-api throws res.errors[0] as a plain object {id, explain, action, ...},
    // not an Error, so propagating it would surface as an opaque rejection in callers.
    // Mail is best-effort (matches the missing-key fallback above) — log and continue
    // so a transient mail outage doesn't roll back sign-up or other write paths.
    console.warn(`[mail] failed to send to ${args.to}: ${formatSendsayError(err)}`)
  }
}

function formatSendsayError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const e = err as { id?: string; explain?: string; action?: string }
    const parts: string[] = []
    if (e.action) parts.push(`action=${e.action}`)
    if (e.id) parts.push(`id=${e.id}`)
    if (e.explain) parts.push(`explain=${e.explain}`)
    if (parts.length > 0) return parts.join(' ')
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
