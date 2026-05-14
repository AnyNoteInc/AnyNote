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
})
