import type { NotificationEvent } from '@repo/db'

export type FormattedNotification = {
  title: string
  body: string
  icon: 'invite' | 'security' | 'role' | 'mention' | 'comment' | 'marketing' | 'system'
}

export function formatNotification(
  event: Pick<NotificationEvent, 'type' | 'payload' | 'resourceUrl'>,
): FormattedNotification {
  const p = (event.payload ?? {}) as Record<string, string | undefined>
  switch (event.type) {
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
      return { title: 'Подозрительная активность', body: p.reason ?? '', icon: 'security' }
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
    case 'WEEKLY_DIGEST':
      return { title: p.title ?? 'Дайджест за неделю', body: p.summary ?? '', icon: 'marketing' }
    case 'PRODUCT_UPDATE':
      return { title: p.title ?? 'Обновление продукта', body: p.body ?? '', icon: 'marketing' }
    default:
      return { title: 'Уведомление', body: '', icon: 'system' }
  }
}
