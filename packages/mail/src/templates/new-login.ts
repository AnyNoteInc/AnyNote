import { esc, formatRuDateTime } from '../utils.js'
import type { MailPayloads, RenderedEmail } from '../types.js'

export function renderNewLogin(p: MailPayloads['new-login']): RenderedEmail {
  const at = formatRuDateTime(p.loggedAtIso)
  const locationLine = p.location ? `\nГеолокация: ${p.location}` : ''
  const locationHtml = p.location ? `<p>Геолокация: ${esc(p.location)}</p>` : ''
  return {
    subject: 'Новый вход в «Любые заметки»',
    text:
      `Здравствуйте, ${p.firstName}.\n\n` +
      `В вашу учётную запись «Любых заметок» выполнен вход.\n` +
      `Время: ${at}\nIP: ${p.ipAddress}\nУстройство: ${p.userAgent}${locationLine}\n\n` +
      `Если это были не вы — смените пароль.`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}.</p>` +
      `<p>В вашу учётную запись «Любых заметок» выполнен вход.</p>` +
      `<p>Время: ${esc(at)}<br>IP: ${esc(p.ipAddress)}<br>Устройство: ${esc(p.userAgent)}</p>` +
      locationHtml +
      `<p>Если это были не вы — смените пароль.</p>`,
  }
}
