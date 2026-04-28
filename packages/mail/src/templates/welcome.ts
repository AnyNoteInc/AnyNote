import { esc } from '../utils.js'
import type { MailPayloads, RenderedEmail } from '../types.js'

export function renderWelcome(p: MailPayloads['welcome']): RenderedEmail {
  return {
    subject: 'Добро пожаловать в AnyNote',
    text:
      `Здравствуйте, ${p.firstName}!\n\n` +
      `AnyNote — это рабочее пространство для заметок, страниц и совместной работы.\n\n` +
      `Перейти в приложение: ${p.appUrl}`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}!</p>` +
      `<p>AnyNote — это рабочее пространство для заметок, страниц и совместной работы.</p>` +
      `<p><a href="${esc(p.appUrl)}">Перейти в приложение</a></p>`,
  }
}
