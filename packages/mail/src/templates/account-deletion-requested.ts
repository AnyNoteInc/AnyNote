import { esc, formatRuDateTime } from '../utils.js'
import type { MailPayloads, RenderedEmail } from '../types.js'

export function renderAccountDeletionRequested(
  p: MailPayloads['account-deletion-requested'],
): RenderedEmail {
  const expires = formatRuDateTime(p.expiresAtIso)
  return {
    subject: 'Подтверждение удаления учётной записи AnyNote',
    text:
      `Здравствуйте, ${p.firstName}.\n\n` +
      `Получен запрос на удаление вашей учётной записи AnyNote.\n` +
      `Чтобы подтвердить удаление, перейдите по ссылке:\n${p.link}\n\n` +
      `Ссылка действительна до ${expires}.\n\n` +
      `Если запрос не от вас — проигнорируйте это письмо.`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>Получен запрос на удаление вашей учётной записи AnyNote.</p>` +
      `<p><a href="${esc(p.link)}">Подтвердить удаление</a></p>` +
      `<p>Ссылка действительна до ${esc(expires)}.</p>` +
      `<p>Если запрос не от вас — проигнорируйте это письмо.</p>`,
  }
}
