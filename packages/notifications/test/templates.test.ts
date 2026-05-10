import { describe, expect, it } from 'vitest'

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
    const result = renderInApp('NEW_LOGIN', { ipAddress: '1.2.3.4', userAgent: 'Chrome' })
    expect(result.title).toBeTruthy()
    expect(result.icon).toBe('security')
  })
})

describe('renderPushPayload', () => {
  it('returns title + body + url for WORKSPACE_INVITE', () => {
    const result = renderPushPayload(
      'WORKSPACE_INVITE',
      { workspaceName: 'Marketing', inviterName: 'Anna' },
      '/workspaces/abc',
    )
    expect(result).not.toBeNull()
    expect(result!.url).toBe('/workspaces/abc')
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
})
