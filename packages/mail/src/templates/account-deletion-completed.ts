import { esc } from '../utils.js'
import type { MailPayloads, RenderedEmail } from '../types.js'

export function renderAccountDeletionCompleted(
  p: MailPayloads['account-deletion-completed'],
): RenderedEmail {
  return {
    subject: 'Ваша учётная запись «Любых заметок» удалена',
    text:
      `Здравствуйте, ${p.firstName}.\n\n` +
      `Ваша учётная запись «Любых заметок» была удалена. ` +
      `Спасибо, что были с нами.`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>Ваша учётная запись «Любых заметок» была удалена. Спасибо, что были с нами.</p>`,
  }
}
