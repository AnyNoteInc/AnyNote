const MAILHOG_API_V2 = process.env.MAILHOG_API ?? 'http://localhost:8025/api/v2'
const MAILHOG_API_V1 = MAILHOG_API_V2.replace('/api/v2', '/api/v1')

type MailhogMessage = {
  ID: string
  From: { Mailbox: string; Domain: string }
  To: Array<{ Mailbox: string; Domain: string }>
  Content: { Headers: Record<string, string[]>; Body: string }
  MIME?: {
    Parts?: Array<{
      Headers?: Record<string, string[]>
      Body: string
    }>
  } | null
}

export async function clearMailhog(): Promise<void> {
  const res = await fetch(`${MAILHOG_API_V1}/messages`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Mailhog clear responded ${res.status}`)
}

export async function getAllMailhogMessages(): Promise<MailhogMessage[]> {
  const res = await fetch(`${MAILHOG_API_V2}/messages`)
  if (!res.ok) throw new Error(`Mailhog responded ${res.status}`)
  const body = (await res.json()) as { items?: MailhogMessage[] }
  return body.items ?? []
}

export async function findLastMessageTo(
  to: string,
  subjectMatch?: RegExp,
): Promise<{ subject: string; text: string; html: string } | null> {
  const items = await getAllMailhogMessages()
  for (const message of items) {
    const recipients = message.To.map((recipient) => `${recipient.Mailbox}@${recipient.Domain}`)
    if (!recipients.includes(to)) continue
    const subject = decodeMimeWord(message.Content.Headers['Subject']?.[0] ?? '')
    if (subjectMatch && !subjectMatch.test(subject)) continue
    const text = decodeMimePart(message, 'text/plain') ?? message.Content.Body
    const html = decodeMimePart(message, 'text/html') ?? message.Content.Body
    return { subject, text, html }
  }
  return null
}

export function extractFirstUrl(content: string, prefix?: string): string | null {
  const normalized = content
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  const re = prefix
    ? new RegExp(String.raw`(${escapeRegex(prefix)}[^\s<>"']+)`)
    : /(https?:\/\/[^\s<>"']+)/
  const match = re.exec(normalized)
  return match?.[1]?.replace(/&amp;/g, '&') ?? null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeMimeWord(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (raw, _charset, encoding, payload) => {
      if (encoding?.toUpperCase() === 'B') {
        try {
          return Buffer.from(payload ?? '', 'base64').toString('utf-8')
        } catch {
          return raw
        }
      }
      return decodeQuotedPrintable((payload ?? '').replace(/_/g, ' '))
    })
}

function decodeMimePart(message: MailhogMessage, contentType: string): string | null {
  const part = message.MIME?.Parts?.find((item) =>
    item.Headers?.['Content-Type']?.[0]?.toLowerCase().includes(contentType),
  )
  if (!part) return null

  const transferEncoding = part.Headers?.['Content-Transfer-Encoding']?.[0]?.toLowerCase()
  if (transferEncoding === 'base64') {
    return Buffer.from(part.Body.replace(/\s/g, ''), 'base64').toString('utf-8')
  }
  if (transferEncoding === 'quoted-printable') {
    return decodeQuotedPrintable(part.Body)
  }
  return part.Body
}

function decodeQuotedPrintable(value: string): string {
  const bytes = value
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_match: string, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
  return Buffer.from(bytes, 'binary').toString('utf-8')
}
