import { esc } from '../utils.ts'
import type { MailPayloads, RenderedEmail } from '../types.ts'

const HUMAN_OFFSETS: Record<number, string> = {
  0: 'в момент истечения',
  60: '1 час',
  1440: '1 день',
  4320: '3 дня',
  10080: '1 неделя',
  43200: '1 месяц',
}

function formatHumanOffset(minutes: number): string {
  return HUMAN_OFFSETS[minutes] ?? 'напоминание'
}

export function renderReminderDue(p: MailPayloads['reminder-due']): RenderedEmail {
  const label = p.label || 'Напоминание'
  const subject =
    p.offsetMinutes > 0
      ? `🔔 Через ${formatHumanOffset(p.offsetMinutes)}: ${label}`
      : `🔔 Напоминание: ${label}`

  const link = `${p.baseUrl}/workspaces/${encodeURIComponent(p.workspaceId)}/pages/${encodeURIComponent(p.pageId)}#reminder-${encodeURIComponent(p.reminderId)}`
  const dueLocal = new Date(p.dueAtIso).toLocaleString('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
  })

  const html = `<!doctype html>
<html lang="ru">
<body style="font-family: sans-serif;">
  <h1 style="margin:0 0 16px 0;">${esc(label)}</h1>
  <p>Дедлайн: <strong>${esc(dueLocal)}</strong></p>
  <p>
    <a href="${esc(link)}" style="display:inline-block; padding:10px 16px; background:#1976d2; color:#fff; text-decoration:none; border-radius:4px;">Открыть страницу</a>
  </p>
</body>
</html>`

  const text = `${label}\n\nДедлайн: ${dueLocal}\n\nСсылка: ${link}\n`

  return { subject, html, text }
}
