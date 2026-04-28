const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch)
}

const RU_DATETIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
})

export function formatRuDateTime(iso: string): string {
  return RU_DATETIME.format(new Date(iso))
}
