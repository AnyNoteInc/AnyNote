import { esc, formatRuDateTime } from '../utils.ts'
import type { MailPayloads, RenderedEmail } from '../types.ts'

export function renderVerifyEmail(p: MailPayloads['verify-email']): RenderedEmail {
  const expires = formatRuDateTime(p.expiresAtIso)
  return {
    subject: 'Подтвердите ваш email',
    text:
      `Здравствуйте, ${p.firstName}.\n\n` +
      `Чтобы завершить регистрацию в «Любых заметках», перейдите по ссылке:\n${p.link}\n\n` +
      `Ссылка действительна до ${expires}.\n\n` +
      `Если вы не регистрировались — проигнорируйте это письмо.`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>Чтобы завершить регистрацию в «Любых заметках», перейдите по ссылке:</p>` +
      `<p><a href="${esc(p.link)}">${esc(p.link)}</a></p>` +
      `<p>Ссылка действительна до ${esc(expires)}.</p>` +
      `<p>Если вы не регистрировались — проигнорируйте это письмо.</p>`,
  }
}
