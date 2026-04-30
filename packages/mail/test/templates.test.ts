import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../src/templates/index.js'
import type { MailPayloads } from '../src/types.js'

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
    const out = renderTemplate('welcome', { firstName: 'Анна', appUrl: 'https://anynote.local/app' })
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
