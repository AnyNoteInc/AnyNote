import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderInApp } from '../src/templates/in-app.ts'
import { renderPushPayload } from '../src/templates/push.ts'
import { renderEmailForEvent } from '../src/templates/registry.ts'

describe('renderInApp', () => {
  it('produces title + body for WORKSPACE_INVITE', () => {
    const result = renderInApp('WORKSPACE_INVITE', {
      workspaceName: 'Marketing',
      inviterName: 'Anna',
    })
    expect(result.title).toMatch(/Anna/)
    expect(result.title).toMatch(/Marketing/)
    expect(result.icon).toBe('invite')
  })

  it('produces a row for ROLE_CHANGED', () => {
    const result = renderInApp('ROLE_CHANGED', {
      workspaceName: 'X',
      newRole: 'EDITOR',
      actorName: 'Anna',
    })
    expect(result.title).toMatch(/EDITOR/i)
  })

  it('produces a row for NEW_LOGIN', () => {
    // RFC 5737: 192.0.2.0/24 is reserved for documentation, never routed.
    const result = renderInApp('NEW_LOGIN', { ipAddress: '192.0.2.1', userAgent: 'Chrome' })
    expect(result.title).toBeTruthy()
    expect(result.icon).toBe('security')
  })

  it('formats REMINDER_DUE as an actionable reminder notification', () => {
    const result = renderInApp('REMINDER_DUE', {
      label: 'Сдать отчет',
      dueAt: '2026-06-15T11:00:00.000Z',
      offsetMinutes: 0,
    })

    expect(result.title).toBe('Напоминание: Сдать отчет')
    expect(result.body).toContain('Дедлайн:')
    expect(result.icon).toBe('system')
  })

  it('formats GUEST_INVITE_REQUESTED with requester and page title', () => {
    const result = renderInApp('GUEST_INVITE_REQUESTED', {
      requesterName: 'Анна Иванова',
      pageTitle: 'Дорожная карта',
      workspaceName: 'Маркетинг',
    })

    expect(result.title).toBe(
      'Анна Иванова запрашивает гостевой доступ к странице «Дорожная карта»',
    )
    expect(result.body).toContain('Маркетинг')
    expect(result.icon).toBe('invite')
  })
})

describe('renderPushPayload', () => {
  it('returns title + body + url for WORKSPACE_INVITE', () => {
    const result = renderPushPayload(
      'WORKSPACE_INVITE',
      { workspaceName: 'Marketing', inviterName: 'Anna' },
      '/workspaces/abc',
    )
    if (result === null) throw new Error('renderPushPayload returned null')
    expect(result.url).toBe('/workspaces/abc')
  })

  it('uses reminder-specific copy for REMINDER_DUE push payloads', () => {
    const result = renderPushPayload(
      'REMINDER_DUE',
      { label: 'Сдать отчет', dueAt: '2026-06-15T11:00:00.000Z', offsetMinutes: 0 },
      '/workspaces/ws/pages/page#reminder-rem',
    )

    expect(result).toMatchObject({
      title: 'Напоминание: Сдать отчет',
      url: '/workspaces/ws/pages/page#reminder-rem',
    })
  })
})

describe('renderEmailForEvent', () => {
  it('maps VERIFY_EMAIL to mail kind', () => {
    const result = renderEmailForEvent('VERIFY_EMAIL', {
      firstName: 'A',
      link: 'l',
      expiresAtIso: '2026-01-01T00:00:00Z',
    })
    expect(result?.kind).toBe('verify-email')
  })

  it('maps WORKSPACE_INVITE to invitation', () => {
    const result = renderEmailForEvent('WORKSPACE_INVITE', {
      firstName: 'A',
      inviterName: 'B',
      workspaceName: 'X',
      link: 'http://l',
    })
    expect(result?.kind).toBe('invitation')
  })

  it('returns null for events without an email template (e.g. ROLE_CHANGED)', () => {
    const result = renderEmailForEvent('ROLE_CHANGED', {})
    expect(result).toBeNull()
  })

  describe('REMINDER_DUE baseUrl resolution', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    const renderReminder = () =>
      renderEmailForEvent('REMINDER_DUE', {
        reminderId: 'rem',
        pageId: 'page',
        workspaceId: 'ws',
        dueAt: '2026-06-15T11:00:00.000Z',
        offsetMinutes: 0,
      }) as { kind: string; data: { baseUrl: string } }

    it('prefers BETTER_AUTH_URL over NEXT_PUBLIC_BASE_URL for the email link', () => {
      vi.stubEnv('BETTER_AUTH_URL', 'https://anynote.ru')
      vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'http://localhost:3000')
      expect(renderReminder().data.baseUrl).toBe('https://anynote.ru')
    })

    it('falls back to NEXT_PUBLIC_BASE_URL when BETTER_AUTH_URL is unset', () => {
      vi.stubEnv('BETTER_AUTH_URL', '')
      vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://fallback.example')
      expect(renderReminder().data.baseUrl).toBe('https://fallback.example')
    })

    it('trims trailing slashes so the link never doubles', () => {
      vi.stubEnv('BETTER_AUTH_URL', 'https://anynote.ru/')
      expect(renderReminder().data.baseUrl).toBe('https://anynote.ru')
    })
  })
})
