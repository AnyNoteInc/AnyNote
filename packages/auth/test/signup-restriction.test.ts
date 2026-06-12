import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sendMailNowMock = vi.fn<(args: unknown) => Promise<void>>(async () => {})

vi.mock('@repo/mail', async () => {
  const actual = await vi.importActual<typeof import('@repo/mail')>('@repo/mail')
  return {
    ...actual,
    sendMailNow: (args: unknown) => sendMailNowMock(args),
  }
})

import { prisma } from '@repo/db'
import { auth, isSignupEmailAllowed } from '../src/auth.js'

describe('isSignupEmailAllowed (pure predicate)', () => {
  it('allows everything when the env is unset', () => {
    expect(isSignupEmailAllowed('user@gmail.com', undefined)).toBe(true)
    expect(isSignupEmailAllowed('user@gmail.com', null)).toBe(true)
  })

  it('allows everything when the env is empty or whitespace/comma noise', () => {
    expect(isSignupEmailAllowed('user@gmail.com', '')).toBe(true)
    expect(isSignupEmailAllowed('user@gmail.com', '  ')).toBe(true)
    expect(isSignupEmailAllowed('user@gmail.com', ' , ,, ')).toBe(true)
  })

  it('allows a matching domain and rejects a non-matching one', () => {
    expect(isSignupEmailAllowed('user@corp.example', 'corp.example')).toBe(true)
    expect(isSignupEmailAllowed('user@gmail.com', 'corp.example')).toBe(false)
  })

  it('matches case-insensitively on both sides', () => {
    expect(isSignupEmailAllowed('User@CORP.Example', 'corp.example')).toBe(true)
    expect(isSignupEmailAllowed('user@corp.example', 'CORP.EXAMPLE')).toBe(true)
  })

  it('supports a comma list with spaces and tolerates a leading @', () => {
    const env = ' corp.example , @second.example,third.example '
    expect(isSignupEmailAllowed('a@corp.example', env)).toBe(true)
    expect(isSignupEmailAllowed('b@second.example', env)).toBe(true)
    expect(isSignupEmailAllowed('c@third.example', env)).toBe(true)
    expect(isSignupEmailAllowed('d@fourth.example', env)).toBe(false)
  })

  it('is an EXACT domain match — subdomains are not implicitly allowed', () => {
    expect(isSignupEmailAllowed('user@mail.corp.example', 'corp.example')).toBe(false)
  })

  it('rejects emails without a usable domain when the restriction is active', () => {
    expect(isSignupEmailAllowed('no-at-sign', 'corp.example')).toBe(false)
    expect(isSignupEmailAllowed('trailing@', 'corp.example')).toBe(false)
    expect(isSignupEmailAllowed('', 'corp.example')).toBe(false)
  })

  it('uses the LAST @ as the domain separator (quoted local parts)', () => {
    expect(isSignupEmailAllowed('"weird@local"@corp.example', 'corp.example')).toBe(true)
  })
})

// ── wire test: the user.create.before hook rejects restricted sign-ups ───────

const TAG = '+signup-restriction-test@anynote.dev'

async function cleanup(): Promise<void> {
  await prisma.subscription.deleteMany({ where: { user: { email: { contains: TAG } } } })
  await prisma.userPreference.deleteMany({ where: { user: { email: { contains: TAG } } } })
  await prisma.account.deleteMany({ where: { user: { email: { contains: TAG } } } })
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } })
}

describe('sign-up restriction hook (wire)', () => {
  beforeEach(async () => {
    sendMailNowMock.mockReset()
    sendMailNowMock.mockResolvedValue(undefined)
    await prisma.plan.upsert({
      where: { slug: 'personal' },
      update: {},
      create: { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
    })
    await cleanup()
  })

  afterEach(async () => {
    await cleanup()
    vi.unstubAllEnvs()
  })

  it('rejects sign-up for a non-allowed domain with the Russian message; no user row', async () => {
    vi.stubEnv('RESTRICT_SIGNUP_EMAIL_DOMAINS', 'corp.example')
    const email = `blocked${TAG}` // domain anynote.dev — not allowed
    await expect(
      auth.api.signUpEmail({
        body: {
          email,
          password: 'StrongPass123!',
          name: 'Blocked User',
          firstName: 'Blocked',
          lastName: 'User',
        },
      }),
    ).rejects.toThrow(/Регистрация ограничена доменами организации/)
    expect(await prisma.user.count({ where: { email } })).toBe(0)
  })

  it('allows sign-up for an allowed domain (the hook still derives name parts)', async () => {
    vi.stubEnv('RESTRICT_SIGNUP_EMAIL_DOMAINS', 'anynote.dev, corp.example')
    const email = `allowed${TAG}`
    await auth.api.signUpEmail({
      body: {
        email,
        password: 'StrongPass123!',
        name: 'Allowed User',
        firstName: 'Allowed',
        lastName: 'User',
      },
    })
    const user = await prisma.user.findFirst({ where: { email } })
    expect(user).not.toBeNull()
    expect(user!.firstName).toBe('Allowed')
  })
})
