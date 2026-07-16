import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../src/templates/index.ts'
import type { MailPayloads } from '../src/types.ts'

const FIXTURE_ISO = '2026-04-28T18:00:00.000Z'
const RU_DATETIME_RX = /\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}/

describe('mail templates', () => {
  it('verify-email', () => {
    const out = renderTemplate('verify-email', {
      firstName: 'Иван',
      link: 'https://anynote.local/api/auth/verify-email?token=abc',
      expiresAtIso: FIXTURE_ISO,
    })
    expect(out.subject).toBe('Подтвердите ваш email')
    expect(out.text).toContain('Иван')
    expect(out.text).toContain('https://anynote.local/api/auth/verify-email?token=abc')
    expect(out.text).toMatch(RU_DATETIME_RX)
    expect(out.html).toContain('Иван')
    expect(out.html).toContain('href="https://anynote.local/api/auth/verify-email?token=abc"')
  })

  it('welcome', () => {
    const out = renderTemplate('welcome', {
      firstName: 'Анна',
      appUrl: 'https://anynote.local/app',
    })
    expect(out.subject).toBe('Добро пожаловать в «Любые заметки»')
    expect(out.text).toContain('Анна')
    expect(out.text).toContain('https://anynote.local/app')
    expect(out.html).toContain('href="https://anynote.local/app"')
  })

  it('reset-password', () => {
    const out = renderTemplate('reset-password', {
      firstName: 'Пётр',
      link: 'https://anynote.local/reset-credentials/T0K3N',
      expiresAtIso: FIXTURE_ISO,
    })
    expect(out.subject).toBe('Восстановление пароля в «Любых заметках»')
    expect(out.text).toContain('https://anynote.local/reset-credentials/T0K3N')
    expect(out.text).toMatch(RU_DATETIME_RX)
    expect(out.html).toContain('href="https://anynote.local/reset-credentials/T0K3N"')
  })

  it('password-changed', () => {
    const out = renderTemplate('password-changed', {
      firstName: 'Иван',
      supportEmail: 'support@anynote.local',
      ipAddress: '203.0.113.42',
    })
    expect(out.subject).toBe('Ваш пароль был изменён')
    expect(out.text).toContain('203.0.113.42')
    expect(out.text).toContain('support@anynote.local')
  })

  it('email-changed (old recipient)', () => {
    const out = renderTemplate('email-changed', {
      firstName: 'Иван',
      oldEmail: 'old@x.com',
      newEmail: 'new@x.com',
      isOldRecipient: true,
    })
    expect(out.text).toContain('old@x.com')
    expect(out.text).toMatch(/больше не привязан/i)
  })

  it('email-changed (new recipient)', () => {
    const out = renderTemplate('email-changed', {
      firstName: 'Иван',
      oldEmail: 'old@x.com',
      newEmail: 'new@x.com',
      isOldRecipient: false,
    })
    expect(out.text).toContain('new@x.com')
    expect(out.text).toMatch(/теперь привязан/i)
  })

  it('new-login', () => {
    const out = renderTemplate('new-login', {
      firstName: 'Иван',
      ipAddress: '203.0.113.42',
      userAgent: 'Mozilla/5.0',
      loggedAtIso: FIXTURE_ISO,
    })
    expect(out.text).toContain('203.0.113.42')
    expect(out.text).toContain('Mozilla/5.0')
    expect(out.text).toMatch(RU_DATETIME_RX)
  })

  it('suspicious-activity', () => {
    const out = renderTemplate('suspicious-activity', {
      firstName: 'Иван',
      reason: 'too_many_failed_logins',
      lockedUntilIso: FIXTURE_ISO,
    })
    expect(out.text).toContain('too_many_failed_logins')
    expect(out.text).toMatch(RU_DATETIME_RX)
  })

  it('invitation', () => {
    const out = renderTemplate('invitation', {
      firstName: 'Иван',
      inviterName: 'Анна',
      workspaceName: 'Project X',
      link: 'https://anynote.local/invite/INV',
    })
    expect(out.text).toContain('Анна')
    expect(out.text).toContain('Project X')
    expect(out.html).toContain('href="https://anynote.local/invite/INV"')
  })

  it('account-deletion-requested', () => {
    const out = renderTemplate('account-deletion-requested', {
      firstName: 'Иван',
      link: 'https://anynote.local/delete-account/TOK',
      expiresAtIso: FIXTURE_ISO,
    })
    expect(out.html).toContain('href="https://anynote.local/delete-account/TOK"')
  })

  it('account-deletion-completed', () => {
    const out = renderTemplate('account-deletion-completed', { firstName: 'Иван' })
    expect(out.subject).toMatch(/удал/i)
    expect(out.text).toContain('Иван')
  })

  it('form-submitted — includes only safe metadata and one response link', () => {
    const out = renderTemplate('form-submitted', {
      formLabel: '<script>Заявка</script>',
      submittedAtIso: FIXTURE_ISO,
      resourceUrl: '/workspaces/ws/pages/page?viewId=view',
      baseUrl: 'https://anynote.ru',
      answers: { email: 'secret@example.test' },
    } as MailPayloads['form-submitted'] & { answers: unknown })

    expect(out.subject).toBe('Новый ответ на форму «<script>Заявка</script>»')
    expect(out.text).toContain('<script>Заявка</script>')
    expect(out.text).toMatch(RU_DATETIME_RX)
    expect(out.text).toContain('https://anynote.ru/workspaces/ws/pages/page?viewId=view')
    expect(out.html).not.toContain('<script>')
    expect(out.html).toContain('&lt;script&gt;Заявка&lt;/script&gt;')
    expect(out.html).toContain('href="https://anynote.ru/workspaces/ws/pages/page?viewId=view"')
    expect(out.html.match(/<a\b/g)).toHaveLength(1)
    expect(out.html).toContain('>Открыть ответы</a>')
    expect(JSON.stringify(out)).not.toContain('secret@example.test')
  })

  it('invoice-request (operator-facing)', () => {
    const out = renderTemplate('invoice-request', {
      legalName: 'ООО «Ромашка»',
      inn: '7707083893',
      workspaceName: 'Команда продаж',
      ownerEmail: 'owner@romashka.ru',
      seats: 12,
      periodMonths: 12,
      comment: 'Нужен счёт до конца месяца',
    })
    expect(out.subject).toBe('Заявка на счёт: ООО «Ромашка» (ИНН 7707083893)')
    expect(out.text).toContain('ООО «Ромашка»')
    expect(out.text).toContain('7707083893')
    expect(out.text).toContain('Команда продаж')
    expect(out.text).toContain('owner@romashka.ru')
    expect(out.text).toContain('Мест: 12')
    expect(out.text).toContain('12 мес.')
    expect(out.text).toContain('Нужен счёт до конца месяца')
    expect(out.html).toContain('owner@romashka.ru')
  })

  it('invoice-request — omits the comment block when absent', () => {
    const out = renderTemplate('invoice-request', {
      legalName: 'ИП Иванов',
      inn: '500100732259',
      workspaceName: 'WS',
      ownerEmail: 'ip@x.ru',
      seats: 3,
      periodMonths: 6,
    })
    expect(out.text).not.toContain('Комментарий')
    expect(out.html).not.toContain('Комментарий')
  })

  it('invoice-request — escapes user-controlled fields in html', () => {
    const out = renderTemplate('invoice-request', {
      legalName: '<script>alert(1)</script>',
      inn: '7707083893',
      workspaceName: 'WS',
      ownerEmail: 'o@x.ru',
      seats: 1,
      periodMonths: 1,
      comment: '<img src=x onerror=alert(2)>',
    })
    expect(out.html).not.toContain('<script>alert')
    expect(out.html).not.toContain('<img src=x')
    expect(out.html).toContain('&lt;script&gt;')
  })

  it('XSS — escapes user-controlled fields in html', () => {
    const out = renderTemplate('verify-email', {
      firstName: '<script>alert(1)</script>',
      link: 'https://x',
      expiresAtIso: FIXTURE_ISO,
    })
    expect(out.html).not.toContain('<script>alert')
    expect(out.html).toContain('&lt;script&gt;')
  })

  it('XSS — escapes link attribute', () => {
    const out = renderTemplate('verify-email', {
      firstName: 'X',
      link: 'https://x.com/?a="><script>',
      expiresAtIso: FIXTURE_ISO,
    })
    expect(out.html).not.toMatch(/<script>/i)
  })
})

const _types: Pick<MailPayloads, 'verify-email'> = {} as never
void _types
