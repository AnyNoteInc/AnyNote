import { describe, expect, it } from 'vitest'

import { formatNotification } from '@/components/notifications/format-notification'

describe('formatNotification', () => {
  it('formats REMINDER_DUE rows with reminder-specific text', () => {
    const result = formatNotification({
      type: 'REMINDER_DUE',
      resourceUrl: '/workspaces/ws/pages/page#reminder-rem',
      payload: {
        label: 'Сдать отчет',
        dueAt: '2026-06-15T11:00:00.000Z',
        offsetMinutes: 0,
      },
    })

    expect(result.title).toBe('Напоминание: Сдать отчет')
    expect(result.body).toContain('Дедлайн:')
    expect(result.icon).toBe('system')
  })

  it('formats FORM_SUBMITTED without exposing answer values', () => {
    const result = formatNotification({
      type: 'FORM_SUBMITTED',
      resourceUrl: '/workspaces/ws/pages/page?viewId=view',
      payload: {
        formLabel: 'Заявка на участие',
        submittedAt: '2026-07-16T12:30:00.000Z',
        answers: { email: 'secret@example.test' },
      },
    })

    expect(result).toEqual({
      title: 'Новый ответ на форму «Заявка на участие»',
      body: '',
      icon: 'system',
    })
    expect(JSON.stringify(result)).not.toContain('secret@example.test')
  })
})
