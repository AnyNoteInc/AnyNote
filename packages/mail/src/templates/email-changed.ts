import { esc } from '../utils.ts'
import type { MailPayloads, RenderedEmail } from '../types.ts'

export function renderEmailChanged(p: MailPayloads['email-changed']): RenderedEmail {
  const subject = p.isOldRecipient
    ? 'Ваш email больше не привязан к учётной записи «Любых заметок»'
    : 'Ваш email теперь привязан к учётной записи «Любых заметок»'
  const body = p.isOldRecipient
    ? `Адрес ${p.oldEmail} больше не привязан к учётной записи «Любых заметок». ` +
      `Новый адрес учётной записи: ${p.newEmail}.`
    : `Адрес ${p.newEmail} теперь привязан к учётной записи «Любых заметок». ` +
      `Прошлый адрес ${p.oldEmail} больше не используется.`
  return {
    subject,
    text: `Здравствуйте, ${p.firstName}.\n\n${body}\n\nЕсли это были не вы — свяжитесь со службой поддержки.`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>${esc(body)}</p>` +
      `<p>Если это были не вы — свяжитесь со службой поддержки.</p>`,
  }
}
