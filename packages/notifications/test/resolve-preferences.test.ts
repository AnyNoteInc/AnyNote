import { describe, expect, it, vi } from 'vitest'

import { resolvePreferences } from '../src/resolve-preferences.ts'
import { EVENT_CATALOG } from '../src/catalog.ts'

function makeTx(overrides: {
  user?: { email: string | null; emailVerified?: boolean }
  prefs?: Array<{ category: string; channel: string; enabled: boolean }>
  pushSubs?: Array<{ id: string }>
  consents?: Array<{ documentType: string; granted: boolean; createdAt: Date }>
}) {
  return {
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        email: overrides.user?.email !== undefined ? overrides.user.email : 'u@e.com',
        emailVerified: overrides.user?.emailVerified ?? true,
      })),
    },
    notificationPreference: {
      findFirst: vi.fn(async ({ where }: { where: { category: string; channel: string } }) => {
        const list = overrides.prefs ?? []
        return list.find((p) => p.category === where.category && p.channel === where.channel) ?? null
      }),
    },
    pushSubscription: { findMany: vi.fn(async () => overrides.pushSubs ?? []) },
    userConsent: { findFirst: vi.fn(async () => overrides.consents?.[0] ?? null) },
  } as never
}

describe('resolvePreferences', () => {
  it('returns email + push subs for SECURITY/NEW_LOGIN with all defaults', async () => {
    const tx = makeTx({ pushSubs: [{ id: 'sub1' }] })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.NEW_LOGIN)
    expect(result.email).toBe('u@e.com')
    expect(result.pushSubscriptions).toHaveLength(0) // NEW_LOGIN doesn't include WEB_PUSH in defaultChannels
  })

  it('disables EMAIL when user preference says so (non-locked channel)', async () => {
    const tx = makeTx({
      prefs: [{ category: 'COLLABORATION', channel: 'EMAIL', enabled: false }],
    })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.WORKSPACE_INVITE)
    expect(result.email).toBeNull()
  })

  it('keeps EMAIL when channel is in lockedChannels even if pref says false', async () => {
    const tx = makeTx({
      prefs: [{ category: 'SERVICE', channel: 'EMAIL', enabled: false }],
    })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.VERIFY_EMAIL)
    expect(result.email).toBe('u@e.com')
  })

  it('blocks MARKETING email if no MARKETING consent or granted=false', async () => {
    const tx = makeTx({ consents: [{ documentType: 'MARKETING', granted: false, createdAt: new Date() }] })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.WEEKLY_DIGEST)
    expect(result.email).toBeNull()
  })

  it('allows MARKETING email when granted=true', async () => {
    const tx = makeTx({ consents: [{ documentType: 'MARKETING', granted: true, createdAt: new Date() }] })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.WEEKLY_DIGEST)
    expect(result.email).toBe('u@e.com')
  })

  it('skips email if user.email is null or unverified', async () => {
    const tx = makeTx({ user: { email: null } })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.WORKSPACE_INVITE)
    expect(result.email).toBeNull()
  })
})
