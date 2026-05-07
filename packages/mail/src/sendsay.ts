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
    console.info(`[mail] sendsay disabled (no SENDSAY_API_KEY); would send to ${args.to}: ${args.subject}`)
    return
  }
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
    group: 'transactional',
  })) as SendsayResponse
  if (response?.errors && response.errors.length > 0) {
    const first = response.errors[0]
    throw new Error(`sendsay error: ${first?.id ?? 'unknown'} - ${first?.explain ?? ''}`)
  }
}
