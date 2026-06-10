// Event catalog literals + ru labels for the webhooks settings UI.
// keep in sync with @repo/webhooks catalog (packages/webhooks/src/catalog.ts) —
// a literal copy so the client bundle never imports the @repo/webhooks runtime.
export const WEBHOOK_EVENT_TYPES = [
  'page.created',
  'page.content_updated',
  'page.properties_updated',
  'page.moved',
  'page.deleted',
  'page.undeleted',
  'comment.created',
  'comment.resolved',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, { label: string; desc: string }> = {
  'page.created': {
    label: 'Страница создана',
    desc: 'Новая страница в командных разделах пространства',
  },
  'page.content_updated': {
    label: 'Содержимое обновлено',
    desc: 'Сохранено новое содержимое страницы',
  },
  'page.properties_updated': {
    label: 'Свойства изменены',
    desc: 'Изменены заголовок, иконка или свойства страницы',
  },
  'page.moved': {
    label: 'Страница перемещена',
    desc: 'У страницы изменился родитель или раздел',
  },
  'page.deleted': {
    label: 'Страница удалена',
    desc: 'Страница перемещена в корзину',
  },
  'page.undeleted': {
    label: 'Страница восстановлена',
    desc: 'Страница восстановлена из корзины',
  },
  'comment.created': {
    label: 'Комментарий создан',
    desc: 'Новый комментарий на странице',
  },
  'comment.resolved': {
    label: 'Комментарий решён',
    desc: 'Обсуждение отмечено как решённое',
  },
}

type ChipColor = 'default' | 'success' | 'error' | 'warning' | 'info'

export const WEBHOOK_STATUS_LABELS: Record<string, { label: string; color: ChipColor }> = {
  PENDING: { label: 'Ожидает проверки', color: 'default' },
  ACTIVE: { label: 'Активен', color: 'success' },
  DISABLED: { label: 'Приостановлен', color: 'default' },
  FAILED: { label: 'Ошибки', color: 'error' },
}

export const DELIVERY_STATUS_LABELS: Record<string, { label: string; color: ChipColor }> = {
  PENDING: { label: 'В очереди', color: 'default' },
  PROCESSING: { label: 'Отправляется', color: 'info' },
  DELIVERED: { label: 'Доставлено', color: 'success' },
  FAILED: { label: 'Ошибка', color: 'error' },
}
