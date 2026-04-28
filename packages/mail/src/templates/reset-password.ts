import { esc, formatRuDateTime } from '../utils.js'
import type { MailPayloads, RenderedEmail } from '../types.js'

export function renderResetPassword(p: MailPayloads['reset-password']): RenderedEmail {
  const expires = formatRuDateTime(p.expiresAtIso)
  return {
    subject: 'Восстановление пароля AnyNote',
    text:
      `Здравствуйте, ${p.firstName}.\n\n` +
      `Чтобы задать новый пароль, перейдите по ссылке:\n${p.link}\n\n` +
      `Ссылка действительна до ${expires}.\n\n` +
      `Если запрос не от вас — проигнорируйте это письмо.`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>Чтобы задать новый пароль, перейдите по ссылке:</p>` +
      `<p><a href="${esc(p.link)}">${esc(p.link)}</a></p>` +
      `<p>Ссылка действительна до ${esc(expires)}.</p>` +
      `<p>Если запрос не от вас — проигнорируйте это письмо.</p>`,
  }
}
