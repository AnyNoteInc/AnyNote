import type { MailKind, MailPayloads } from './types.ts'
import { renderTemplate } from './templates/index.ts'
import { getMailTransport } from './transport.ts'

export type SendMailNowArgs<K extends MailKind> = {
  kind: K
  to: string
  data: MailPayloads[K]
}

export async function sendMailNow<K extends MailKind>(args: SendMailNowArgs<K>): Promise<void> {
  const from = process.env.MAIL_FROM
  if (!from) throw new Error('MAIL_FROM env var is required')
  const rendered = renderTemplate(args.kind, args.data)
  const transport = getMailTransport()
  await transport.sendMail({
    from,
    to: args.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  })
}
