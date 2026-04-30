import { esc } from '../utils.js'
import type { MailPayloads, RenderedEmail } from '../types.js'

export function renderInvitation(p: MailPayloads['invitation']): RenderedEmail {
  const greeting = p.firstName ? `Здравствуйте, ${p.firstName}.` : 'Здравствуйте.'
  const greetingHtml = p.firstName
    ? `<p>Здравствуйте, ${esc(p.firstName)}.</p>`
    : `<p>Здравствуйте.</p>`
  return {
    subject: `${p.inviterName} приглашает вас в «Любые заметки»`,
    text:
      `${greeting}\n\n` +
      `${p.inviterName} приглашает вас присоединиться к рабочему пространству "${p.workspaceName}" в «Любых заметках».\n\n` +
      `Принять приглашение: ${p.link}`,
    html:
      `${greetingHtml}` +
      `<p>${esc(p.inviterName)} приглашает вас присоединиться к рабочему пространству ` +
      `«${esc(p.workspaceName)}» в «Любых заметках».</p>` +
      `<p><a href="${esc(p.link)}">Принять приглашение</a></p>`,
  }
}
