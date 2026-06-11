import { esc } from '../utils.ts'
import type { MailPayloads, RenderedEmail } from '../types.ts'

/**
 * Page-guest invitation. The page TITLE is deliberately absent — the recipient
 * has not accepted yet, and pre-acceptance mail must not leak page content
 * (people spec §6: «N. пригласил вас к странице в пространстве W»).
 */
export function renderGuestInvitation(p: MailPayloads['guest-invitation']): RenderedEmail {
  return {
    subject: `${p.inviterName} приглашает вас к странице в «Любых заметках»`,
    text:
      `Здравствуйте.\n\n` +
      `${p.inviterName} приглашает вас к странице в пространстве "${p.workspaceName}" в «Любых заметках».\n\n` +
      `Открыть приглашение: ${p.link}`,
    html:
      `<p>Здравствуйте.</p>` +
      `<p>${esc(p.inviterName)} приглашает вас к странице в пространстве ` +
      `«${esc(p.workspaceName)}» в «Любых заметках».</p>` +
      `<p><a href="${esc(p.link)}">Открыть приглашение</a></p>`,
  }
}
