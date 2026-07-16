import type { NotificationEventType } from '@repo/db'

export type InAppRendered = {
  title: string
  body: string
  icon: 'invite' | 'security' | 'role' | 'mention' | 'comment' | 'system' | 'marketing'
}

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

function formatReminderDue(payload: Record<string, unknown>): InAppRendered {
  const label = typeof payload.label === 'string' && payload.label ? payload.label : 'Напоминание'
  const offsetMinutes = typeof payload.offsetMinutes === 'number' ? payload.offsetMinutes : 0
  const dueAt = typeof payload.dueAt === 'string' ? payload.dueAt : ''
  const due = dueAt
    ? new Date(dueAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : ''

  return {
    title:
      offsetMinutes > 0
        ? `Через ${formatHumanOffset(offsetMinutes)}: ${label}`
        : `Напоминание: ${label}`,
    body: due ? `Дедлайн: ${due}` : '',
    icon: 'system',
  }
}

export function renderInApp(
  type: NotificationEventType,
  payload: Record<string, unknown>,
): InAppRendered {
  const p = payload as Record<string, string | undefined>
  switch (type) {
    case 'WORKSPACE_INVITE':
      return {
        title: `${p.inviterName ?? 'Кто-то'} пригласил вас в "${p.workspaceName ?? 'пространство'}"`,
        body: '',
        icon: 'invite',
      }
    case 'ROLE_CHANGED':
      return {
        title: `Ваша роль в "${p.workspaceName ?? 'пространстве'}" изменена на ${p.newRole ?? ''}`,
        body: p.actorName ? `Изменил: ${p.actorName}` : '',
        icon: 'role',
      }
    case 'NEW_LOGIN':
      return {
        title: 'Новый вход в аккаунт',
        body: [p.ipAddress, p.userAgent].filter(Boolean).join(' · '),
        icon: 'security',
      }
    case 'SUSPICIOUS_ACTIVITY':
      return {
        title: 'Подозрительная активность',
        body: p.reason ?? '',
        icon: 'security',
      }
    case 'PAGE_MENTION':
      return {
        title: `${p.actorName ?? 'Кто-то'} упомянул вас`,
        body: p.snippet ?? '',
        icon: 'mention',
      }
    case 'COMMENT_CREATED':
      return {
        title: `${p.actorName ?? 'Кто-то'} оставил комментарий`,
        body: p.snippet ?? '',
        icon: 'comment',
      }
    case 'REMINDER_DUE':
      return formatReminderDue(payload)
    case 'GUEST_INVITE_REQUESTED':
      return {
        title: `${p.requesterName ?? 'Кто-то'} запрашивает гостевой доступ к странице «${p.pageTitle ?? 'Без названия'}»`,
        body: p.workspaceName ? `Пространство: ${p.workspaceName}` : '',
        icon: 'invite',
      }
    case 'FORM_SUBMITTED':
      return {
        title: `Новый ответ на форму «${p.formLabel || 'Без названия'}»`,
        body: '',
        icon: 'system',
      }
    default:
      return { title: 'Уведомление', body: '', icon: 'system' }
  }
}
