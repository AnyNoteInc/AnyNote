import { esc, formatRuDateTime } from '../utils.js'
import type { MailPayloads, RenderedEmail } from '../types.js'

export function renderSuspiciousActivity(
  p: MailPayloads['suspicious-activity'],
): RenderedEmail {
  const lockedUntil = p.lockedUntilIso ? formatRuDateTime(p.lockedUntilIso) : null
  const lockedLine = lockedUntil ? `\nДоступ временно ограничен до: ${lockedUntil}` : ''
  const lockedHtml = lockedUntil
    ? `<p>Доступ временно ограничен до: ${esc(lockedUntil)}</p>`
    : ''
  return {
    subject: 'Подозрительная активность в «Любых заметках»',
    text:
      `Здравствуйте, ${p.firstName}.\n\n` +
      `Мы зафиксировали подозрительную активность в вашей учётной записи «Любых заметок».\n` +
      `Причина: ${p.reason}${lockedLine}\n\n` +
      `Если это были не вы — смените пароль и свяжитесь со службой поддержки.`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>Мы зафиксировали подозрительную активность в вашей учётной записи «Любых заметок».</p>` +
      `<p>Причина: ${esc(p.reason)}</p>` +
      lockedHtml +
      `<p>Если это были не вы — смените пароль и свяжитесь со службой поддержки.</p>`,
  }
}
