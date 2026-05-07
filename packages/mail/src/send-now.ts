import type { MailKind, MailPayloads } from './types.ts'
import { renderTemplate } from './templates/index.ts'
import { sendEmail } from './sendsay.ts'

export type SendMailNowArgs<K extends MailKind> = {
  kind: K
  to: string
  data: MailPayloads[K]
}

export async function sendMailNow<K extends MailKind>(args: SendMailNowArgs<K>): Promise<void> {
  const rendered = renderTemplate(args.kind, args.data)
  await sendEmail({
    to: args.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  })
}
