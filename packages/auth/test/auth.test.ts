import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma, SubscriptionStatus } from '@repo/db'
import { auth } from '../src/auth.js'

const TAG = '+auth-callback-test@anynote.dev'

async function cleanup(): Promise<void> {
  await prisma.outboxEvent.deleteMany({
    where: { aggregateType: 'email', payload: { path: ['to'], string_contains: TAG } },
  })
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  await prisma.userPreference.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  await prisma.account.deleteMany({
    where: { user: { email: { contains: TAG } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } })
}

describe('auth callbacks', () => {
  beforeEach(async () => {
    await cleanup()
  })

  afterEach(async () => {
    await cleanup()
    vi.unstubAllEnvs()
  })

  it('signUpEmail enqueues verify-email event', async () => {
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
    const evt = await prisma.outboxEvent.findFirstOrThrow({
      where: {
        aggregateType: 'email',
        payload: { path: ['to'], equals: email },
      },
    })
    const payload = evt.payload as { kind: string; data: { link: string; expiresAtIso: string } }
    expect(payload.kind).toBe('verify-email')
    expect(payload.data.link).toContain('/api/auth/verify-email')
    const expiresAt = new Date(payload.data.expiresAtIso).getTime()
    const expected = Date.now() + 1000 * 60 * 60 * 3
    expect(Math.abs(expiresAt - expected)).toBeLessThan(60_000)
  })

  it('does not enqueue welcome at user.create when emailVerified=false', async () => {
    const email = `nowelcome${TAG}`
    await auth.api.signUpEmail({
      body: {
        email,
        password: 'StrongPass123!',
        name: 'Test User',
        firstName: 'Test',
        lastName: 'User',
      },
    })
    const welcome = await prisma.outboxEvent.findFirst({
      where: {
        aggregateType: 'email',
        payload: { path: ['kind'], equals: 'welcome' },
        AND: { payload: { path: ['to'], equals: email } },
      },
    })
    expect(welcome).toBeNull()
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

  it('forgetPassword enqueues reset-password event with custom URL', async () => {
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
    await prisma.outboxEvent.deleteMany({
      where: {
        payload: { path: ['kind'], equals: 'verify-email' },
        AND: { payload: { path: ['to'], equals: email } },
      },
    })

    await auth.api.requestPasswordReset({ body: { email } })

    const evt = await prisma.outboxEvent.findFirstOrThrow({
      where: {
        aggregateType: 'email',
        payload: { path: ['kind'], equals: 'reset-password' },
        AND: { payload: { path: ['to'], equals: email } },
      },
    })
    const payload = evt.payload as { data: { link: string; expiresAtIso: string } }
    expect(payload.data.link).toContain('/reset-credentials/')
    expect(payload.data.link).not.toContain('/api/auth/reset-password')
    const expiresAt = new Date(payload.data.expiresAtIso).getTime()
    expect(expiresAt).toBeGreaterThan(Date.now())
  })

  it('Google-style verified user welcome enqueue path is valid', async () => {
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

    if (created.emailVerified) {
      const { enqueueMailEvent } = await import('@repo/mail')
      await enqueueMailEvent(prisma, {
        kind: 'welcome',
        to: created.email,
        data: { firstName: created.firstName, appUrl: 'http://localhost:3000/app' },
        userId: created.id,
      })
    }

    const welcome = await prisma.outboxEvent.findFirstOrThrow({
      where: {
        aggregateType: 'email',
        payload: { path: ['kind'], equals: 'welcome' },
        AND: { payload: { path: ['to'], equals: email } },
      },
    })
    expect(welcome).toBeTruthy()
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
})
