import { esc } from '../utils.ts'
import type { MailPayloads, RenderedEmail } from '../types.ts'

export function renderPasswordChanged(p: MailPayloads['password-changed']): RenderedEmail {
  const ipLine = p.ipAddress ? `\nIP-адрес: ${p.ipAddress}` : ''
  const ipHtml = p.ipAddress ? `<p>IP-адрес: ${esc(p.ipAddress)}</p>` : ''
  return {
    subject: 'Ваш пароль был изменён',
    text:
      `Здравствуйте, ${p.firstName}.\n\n` +
      `Пароль вашей учётной записи «Любых заметок» был изменён.${ipLine}\n\n` +
      `Если это были не вы — немедленно свяжитесь со службой поддержки: ${p.supportEmail}`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>Пароль вашей учётной записи «Любых заметок» был изменён.</p>` +
      ipHtml +
      `<p>Если это были не вы — немедленно свяжитесь со службой поддержки: ` +
      `<a href="mailto:${esc(p.supportEmail)}">${esc(p.supportEmail)}</a></p>`,
  }
}
