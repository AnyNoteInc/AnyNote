import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
})
