import type { Prisma, PrismaClient } from '@repo/db'

import type { EventDescriptor, ResolvedTargets } from './types.ts'

type Tx = Prisma.TransactionClient | PrismaClient

async function resolveEmail(
  tx: Tx,
  userId: string,
  descriptor: EventDescriptor,
  user: { email: string | null; emailVerified: boolean },
): Promise<string | null> {
  if (!descriptor.defaultChannels.includes('EMAIL')) return null

  const prefRow = await tx.notificationPreference.findFirst({
    where: { userId, category: descriptor.category, channel: 'EMAIL' },
  })
  const emailLocked = descriptor.lockedChannels.includes('EMAIL')
  const enabled = emailLocked || prefRow?.enabled !== false
  if (!enabled) return null

  // SERVICE emails (verify-email, reset-password, etc.) skip the
  // emailVerified gate — verify-email by definition goes to unverified users.
  const emailReachable =
    !!user.email && (descriptor.category === 'SERVICE' || user.emailVerified)
  if (!emailReachable) return null

  if (descriptor.requiresConsent === 'MARKETING') {
    const latest = await tx.userConsent.findFirst({
      where: { userId, documentType: 'MARKETING' },
      orderBy: { createdAt: 'desc' },
    })
    if (!latest?.granted) return null
  }

  return user.email
}

async function resolvePushSubscriptions(
  tx: Tx,
  userId: string,
  descriptor: EventDescriptor,
): Promise<ResolvedTargets['pushSubscriptions']> {
  if (!descriptor.defaultChannels.includes('WEB_PUSH')) return []

  const prefRow = await tx.notificationPreference.findFirst({
    where: { userId, category: descriptor.category, channel: 'WEB_PUSH' },
  })
  const pushLocked = descriptor.lockedChannels.includes('WEB_PUSH')
  const enabled = pushLocked || prefRow?.enabled !== false
  if (!enabled) return []

  return tx.pushSubscription.findMany({ where: { userId } })
}

export async function resolvePreferences(
  tx: Tx,
  userId: string,
  descriptor: EventDescriptor,
): Promise<ResolvedTargets> {
  const wantEmail = descriptor.defaultChannels.includes('EMAIL')
  const wantPush = descriptor.defaultChannels.includes('WEB_PUSH')
  if (!wantEmail && !wantPush) {
    return { email: null, pushSubscriptions: [] }
  }

  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  })

  const [email, pushSubscriptions] = await Promise.all([
    resolveEmail(tx, userId, descriptor, user),
    resolvePushSubscriptions(tx, userId, descriptor),
  ])

  return { email, pushSubscriptions }
}
