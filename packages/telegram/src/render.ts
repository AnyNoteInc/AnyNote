import type { WebhookEventType } from '@repo/webhooks'

/**
 * Telegram `parse_mode: 'HTML'` escaping — applied to every interpolated
 * value (titles, actor names, URLs in href position) so page titles can never
 * inject markup into outgoing messages.
 */
export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function anchor(url: string, title: string): string {
  const safeTitle = title.trim() === '' ? 'Без названия' : title
  return `<a href="${escapeHtml(url)}">${escapeHtml(safeTitle)}</a>`
}

/**
 * One template per catalog event type — a `Record` keyed by the imported
 * union, so adding a 9th event type to `@repo/webhooks` fails compilation
 * here until a Russian one-liner exists for it.
 */
const EVENT_TEMPLATES: Record<WebhookEventType, (link: string) => string> = {
  'page.created': (link) => `📄 Новая страница: ${link}`,
  'page.content_updated': (link) => `✏️ Страница обновлена: ${link}`,
  'page.properties_updated': (link) => `🧩 Свойства страницы изменены: ${link}`,
  'page.moved': (link) => `📦 Страница перемещена: ${link}`,
  'page.deleted': (link) => `🗑 Страница удалена: ${link}`,
  'page.undeleted': (link) => `♻️ Страница восстановлена: ${link}`,
  'comment.created': (link) => `💬 Новый комментарий на странице ${link}`,
  'comment.resolved': (link) => `✅ Комментарий решён на странице ${link}`,
}

export function renderEventMessage(args: {
  eventType: WebhookEventType
  pageTitle: string
  pageUrl: string
  actorName: string | null
}): string {
  const base = EVENT_TEMPLATES[args.eventType](anchor(args.pageUrl, args.pageTitle))
  return args.actorName === null ? base : `${base} — ${escapeHtml(args.actorName)}`
}

export function renderHelp(): string {
  return [
    'Я бот AnyNote. Команды:',
    '/help — эта справка',
    '/link КОД — привязать ваш аккаунт AnyNote (код выдаётся в Настройки → Интеграции)',
    '/search запрос — поиск по названиям страниц подписанных разделов',
    '/get ID — карточка страницы по идентификатору',
    '',
    '/search и /get доступны только участникам пространства, привязавшим аккаунт через /link.',
  ].join('\n')
}

export function renderSearchResults(items: Array<{ title: string; url: string }>): string {
  if (items.length === 0) return 'Ничего не найдено.'
  return ['🔍 Найдено:', ...items.map((item, i) => `${i + 1}. ${anchor(item.url, item.title)}`)].join(
    '\n',
  )
}

/** Uniform for invalid id / non-visible / trashed — no existence oracle. */
export function renderNotFound(): string {
  return 'Страница не найдена.'
}

export function renderNotLinked(): string {
  return 'Сначала свяжите аккаунт: получите код в AnyNote (Настройки → Интеграции) и отправьте /link КОД.'
}

export function renderDenied(): string {
  return 'Доступ запрещён.'
}
