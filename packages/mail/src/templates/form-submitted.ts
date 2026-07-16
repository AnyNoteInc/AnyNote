import { esc, formatRuDateTime } from '../utils.ts'
import type { MailPayloads, RenderedEmail } from '../types.ts'

function responseUrl(baseUrl: string, resourceUrl: string): string {
  const origin = baseUrl.trim().replace(/\/+$/, '')
  const path = resourceUrl.startsWith('/') && !resourceUrl.startsWith('//') ? resourceUrl : '/'
  return `${origin}${path}`
}

export function renderFormSubmitted(p: MailPayloads['form-submitted']): RenderedEmail {
  const formLabel = p.formLabel.trim() || 'Без названия'
  const submittedAt = formatRuDateTime(p.submittedAtIso)
  const link = responseUrl(p.baseUrl, p.resourceUrl)
  const subject = `Новый ответ на форму «${formLabel}»`

  const html = `<!doctype html>
<html lang="ru">
<body style="font-family: sans-serif;">
  <h1 style="margin:0 0 16px 0;">${esc(subject)}</h1>
  <p>Получен новый ответ: <strong>${esc(submittedAt)}</strong></p>
  <p>
    <a href="${esc(link)}" style="display:inline-block; padding:10px 16px; background:#1976d2; color:#fff; text-decoration:none; border-radius:4px;">Открыть ответы</a>
  </p>
</body>
</html>`

  const text = `${subject}\n\nПолучен: ${submittedAt}\n\nОткрыть ответы: ${link}\n`

  return { subject, html, text }
}
