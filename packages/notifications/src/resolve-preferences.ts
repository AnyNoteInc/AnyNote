import type { Prisma, PrismaClient } from '@repo/db'

import type { EventDescriptor, ResolvedTargets } from './types.ts'

type Tx = Prisma.TransactionClient | PrismaClient

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

  let email: string | null = null
  if (wantEmail) {
    const emailLocked = descriptor.lockedChannels.includes('EMAIL')
    const prefRow = await tx.notificationPreference.findFirst({
      where: { userId, category: descriptor.category, channel: 'EMAIL' },
    })
    const enabled = emailLocked || prefRow?.enabled !== false
    if (enabled && user.email && user.emailVerified) {
      if (descriptor.requiresConsent === 'MARKETING') {
        const latest = await tx.userConsent.findFirst({
          where: { userId, documentType: 'MARKETING' },
          orderBy: { createdAt: 'desc' },
        })
        if (latest?.granted) {
          email = user.email
        }
      } else {
        email = user.email
      }
    }
  }

  let pushSubscriptions: ResolvedTargets['pushSubscriptions'] = []
  if (wantPush) {
    const pushLocked = descriptor.lockedChannels.includes('WEB_PUSH')
    const prefRow = await tx.notificationPreference.findFirst({
      where: { userId, category: descriptor.category, channel: 'WEB_PUSH' },
    })
    const enabled = pushLocked || prefRow?.enabled !== false
    if (enabled) {
      pushSubscriptions = await tx.pushSubscription.findMany({ where: { userId } })
    }
  }

  return { email, pushSubscriptions }
}
