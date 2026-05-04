import { esc } from '../utils.ts'
import type { MailPayloads, RenderedEmail } from '../types.ts'

export function renderWelcome(p: MailPayloads['welcome']): RenderedEmail {
  return {
    subject: 'Добро пожаловать в «Любые заметки»',
    text:
      `Здравствуйте, ${p.firstName}!\n\n` +
      `«Любые заметки» — это рабочее пространство для заметок, страниц и совместной работы.\n\n` +
      `Перейти в приложение: ${p.appUrl}`,
    html:
      `<p>Здравствуйте, ${esc(p.firstName)}!</p>` +
      `<p>«Любые заметки» — это рабочее пространство для заметок, страниц и совместной работы.</p>` +
      `<p><a href="${esc(p.appUrl)}">Перейти в приложение</a></p>`,
  }
}
