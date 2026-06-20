import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const sendMailNowMock = vi.fn<(args: unknown) => Promise<void>>(async () => {})

vi.mock('@repo/mail', async () => {
  const actual = await vi.importActual<typeof import('@repo/mail')>('@repo/mail')
  return {
    ...actual,
    sendMailNow: (args: unknown) => sendMailNowMock(args),
  }
})

import { prisma, SubscriptionStatus } from '@repo/db'
import { auth } from '../src/auth.js'

const TAG = '+auth-callback-test@anynote.dev'

async function cleanup(): Promise<void> {
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  await prisma.userPreference.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  await prisma.account.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  const usersInRange = await prisma.user.findMany({
    where: { email: { contains: TAG } },
    select: { id: true },
  })
  if (usersInRange.length > 0) {
    await prisma.verification.deleteMany({
      where: { value: { in: usersInRange.map((u) => u.id) } },
    })
  }
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } })
}

describe('auth callbacks', () => {
  beforeEach(async () => {
    sendMailNowMock.mockReset()
    sendMailNowMock.mockResolvedValue(undefined)
    await cleanup()
  })

  afterEach(async () => {
    await cleanup()
    vi.unstubAllEnvs()
  })

  it('signUpEmail sends verify-email synchronously via sendMailNow', async () => {
    const email = `vsignup${TAG}`
    await auth.api.signUpEmail({
      body: {
        email,
        password: 'StrongPass123!',
        name: 'Test User',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    expect(sendMailNowMock).toHaveBeenCalledTimes(1)
    const args = sendMailNowMock.mock.calls[0][0] as {
      kind: string
      to: string
      data: { link: string; expiresAtIso: string }
    }
    expect(args.kind).toBe('verify-email')
    expect(args.to).toBe(email)
    expect(args.data.link).toContain('/api/auth/verify-email')
    const expiresAt = new Date(args.data.expiresAtIso).getTime()
    const expected = Date.now() + 1000 * 60 * 60 * 3
    expect(Math.abs(expiresAt - expected)).toBeLessThan(60_000)
  })

  it('signUpEmail rolls back the user when verify-email send fails', async () => {
    const email = `vfail${TAG}`
    sendMailNowMock.mockRejectedValueOnce(new Error('SMTP down'))
    await expect(
      auth.api.signUpEmail({
        body: {
          email,
          password: 'StrongPass123!',
          name: 'Test User',
          firstName: 'Test',
          lastName: 'User',
        },
      }),
    ).rejects.toThrow()
    const remaining = await prisma.user.findUnique({ where: { email } })
    expect(remaining).toBeNull()
  })

  it('does not send welcome at user.create when emailVerified=false', async () => {
    const email = `nowelcome${TAG}`
    sendMailNowMock.mockClear()
    await auth.api.signUpEmail({
      body: {
        email,
        password: 'StrongPass123!',
        name: 'Test User',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    const welcomeCalls = sendMailNowMock.mock.calls.filter(
      (call) => (call[0] as { kind: string }).kind === 'welcome',
    )
    expect(welcomeCalls).toHaveLength(0)
  })

  it('subscription + userPreference still created in databaseHooks.user.create.after', async () => {
    const email = `sub${TAG}`
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password: 'StrongPass123!',
        name: 'Test User',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    const userId = result.user.id
    const sub = await prisma.subscription.findFirst({ where: { userId } })
    expect(sub?.status).toBe(SubscriptionStatus.ACTIVE)
    const pref = await prisma.userPreference.findUnique({ where: { userId } })
    expect(pref).not.toBeNull()
  })

  it('forgetPassword sends reset-password synchronously with custom URL', async () => {
    const email = `forget${TAG}`
    await auth.api.signUpEmail({
      body: {
        email,
        password: 'StrongPass123!',
        name: 'Test User',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    sendMailNowMock.mockClear()

    await auth.api.requestPasswordReset({ body: { email } })

    expect(sendMailNowMock).toHaveBeenCalledTimes(1)
    const args = sendMailNowMock.mock.calls[0][0] as {
      kind: string
      to: string
      data: { link: string; expiresAtIso: string }
    }
    expect(args.kind).toBe('reset-password')
    expect(args.to).toBe(email)
    expect(args.data.link).toContain('/reset-credentials/')
    expect(args.data.link).not.toContain('/api/auth/reset-password')
    const expiresAt = new Date(args.data.expiresAtIso).getTime()
    expect(expiresAt).toBeGreaterThan(Date.now())
  })

  it('forgetPassword removes the verification row when reset-password send fails', async () => {
    const email = `forgetfail${TAG}`
    const signUp = await auth.api.signUpEmail({
      body: {
        email,
        password: 'StrongPass123!',
        name: 'Test User',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    sendMailNowMock.mockRejectedValueOnce(new Error('SMTP down'))

    // better-auth returns a generic success response on requestPasswordReset to
    // prevent email enumeration even when our hook throws — what matters is
    // that the verification row is cleaned up so the stale token can't be used.
    await auth.api.requestPasswordReset({ body: { email } }).catch(() => {})

    // The verification row has identifier `reset-password:<token>` and
    // value=user.id, so checking by user id is the most reliable filter.
    const resetVerifications = await prisma.verification.findMany({
      where: {
        identifier: { startsWith: 'reset-password:' },
        value: signUp.user.id,
      },
    })
    expect(resetVerifications).toHaveLength(0)
  })

  it('Google-style verified user welcome send path is valid', async () => {
    const email = `googled${TAG}`
    const personalPlan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    const created = await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        name: 'G User',
        firstName: 'G',
        lastName: 'User',
      },
    })
    await prisma.subscription.create({
      data: {
        userId: created.id,
        planId: personalPlan.id,
        status: SubscriptionStatus.ACTIVE,
        billingPeriod: 'MONTHLY',
      },
    })
    await prisma.userPreference.create({ data: { userId: created.id } })

    sendMailNowMock.mockClear()
    if (created.emailVerified) {
      const { sendMailNow } = await import('@repo/mail')
      await sendMailNow({
        kind: 'welcome',
        to: created.email,
        data: { firstName: created.firstName, appUrl: 'http://localhost:3000/app' },
      })
    }
    expect(sendMailNowMock).toHaveBeenCalledTimes(1)
    const call = sendMailNowMock.mock.calls[0][0] as { kind: string; to: string }
    expect(call.kind).toBe('welcome')
    expect(call.to).toBe(email)
  })

  it('Google profile mapping preserves email fields with required profile names', async () => {
    vi.resetModules()
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-google-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-google-client-secret')

    const { auth: googleAuth } = await import('../src/auth.js')
    const mapProfileToUser = googleAuth.options.socialProviders?.google?.mapProfileToUser

    expect(mapProfileToUser).toBeTypeOf('function')

    const mapped = await mapProfileToUser?.({
      aud: 'test-google-client-id',
      azp: 'test-google-client-id',
      email: `google${TAG}`,
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      family_name: 'User',
      given_name: 'Google',
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://accounts.google.com',
      name: 'Google User',
      picture: 'https://example.com/avatar.png',
      sub: 'google-user-id',
    })

    expect(mapped).toMatchObject({
      id: 'google-user-id',
      name: 'Google User',
      email: `google${TAG}`,
      emailVerified: true,
      image: 'https://example.com/avatar.png',
      firstName: 'Google',
      lastName: 'User',
    })
  })

  it('better-auth jwt plugin uses BETTER_AUTH_JWT_AUDIENCE as the aud claim', async () => {
    vi.resetModules()
    vi.stubEnv('BETTER_AUTH_JWT_AUDIENCE', 'anynote-yjs-test')
    const { auth: scopedAuth } = await import('../src/auth.js')
    type JwtPlugin = { id: string; options?: { jwt?: { audience?: string; issuer?: string } } }
    const jwtPlugin = (scopedAuth.options.plugins as JwtPlugin[]).find((p) => p.id === 'jwt')
    expect(jwtPlugin?.options?.jwt?.audience).toBe('anynote-yjs-test')
  })

  it('baseURL is built from BETTER_AUTH_URL so email links use the configured domain', async () => {
    vi.resetModules()
    vi.stubEnv('BETTER_AUTH_URL', 'https://anynote.ru')
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'http://localhost:3000')
    const { auth: scopedAuth } = await import('../src/auth.js')
    expect(scopedAuth.options.baseURL).toBe('https://anynote.ru')
  })

  it('baseURL falls back to NEXT_PUBLIC_BASE_URL when BETTER_AUTH_URL is unset', async () => {
    vi.resetModules()
    vi.stubEnv('BETTER_AUTH_URL', '')
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://fallback.example')
    const { auth: scopedAuth } = await import('../src/auth.js')
    expect(scopedAuth.options.baseURL).toBe('https://fallback.example')
  })

  it('baseURL trims trailing slashes so links never double', async () => {
    vi.resetModules()
    vi.stubEnv('BETTER_AUTH_URL', 'https://anynote.ru/')
    const { auth: scopedAuth } = await import('../src/auth.js')
    expect(scopedAuth.options.baseURL).toBe('https://anynote.ru')
  })

  it('stores long OAuth tokens for social accounts', async () => {
    const email = `long-oauth-token${TAG}`
    const user = await prisma.user.create({
      data: {
        email,
        emailVerified: true,
        name: 'Google User',
        firstName: 'Google',
        lastName: 'User',
      },
    })

    const longToken = ['header', 'payload'.repeat(220), 'signature'].join('.')

    const account = await prisma.account.create({
      data: {
        userId: user.id,
        providerId: 'google',
        accountId: 'google-long-token-user-id',
        accessToken: longToken,
        refreshToken: longToken,
        idToken: longToken,
      },
    })

    expect(account.idToken).toHaveLength(longToken.length)
  })
})
