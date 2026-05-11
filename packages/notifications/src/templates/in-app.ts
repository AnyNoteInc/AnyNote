import type { NotificationEventType } from '@repo/db'

export type InAppRendered = {
  title: string
  body: string
  icon: 'invite' | 'security' | 'role' | 'mention' | 'comment' | 'system' | 'marketing'
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
    default:
      return { title: 'Уведомление', body: '', icon: 'system' }
  }
}
