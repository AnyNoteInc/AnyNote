import { sendMailNow, type MailKind, type MailPayloads } from '@repo/mail'
import type { Prisma, PrismaClient, NotificationEvent } from '@repo/db'

import { EVENT_CATALOG } from './catalog.ts'
import { resolvePreferences } from './resolve-preferences.ts'
import { renderEmailForEvent } from './templates/registry.ts'
import type { EmitArgs } from './types.ts'

type Tx = Prisma.TransactionClient

type SyncEmail = { kind: MailKind; to: string; data: MailPayloads[MailKind] }

export async function emit(prisma: PrismaClient, args: EmitArgs): Promise<NotificationEvent> {
  const descriptor = EVENT_CATALOG[args.type]
  if (!descriptor) throw new Error(`emit: unknown event type ${args.type}`)

  const { event, syncEmail } = await prisma.$transaction(async (tx: Tx) => {
    const created = await tx.notificationEvent.create({
      data: {
        type: args.type,
        category: descriptor.category,
        userId: args.userId,
        workspaceId: args.workspaceId,
        actorId: args.actorId,
        resourceUrl: args.resourceUrl,
        payload: args.payload as Prisma.InputJsonValue,
      },
    })

    const wantsInApp =
      descriptor.defaultChannels.includes('IN_APP') || descriptor.lockedChannels.includes('IN_APP')
    if (wantsInApp) {
      await tx.notificationInApp.create({
        data: { eventId: created.id, userId: args.userId },
      })
    }

    const targets = await resolvePreferences(tx, args.userId, descriptor)

    let outgoing: SyncEmail | null = null
    if (descriptor.category === 'SERVICE' && targets.email) {
      const rendered = renderEmailForEvent(args.type, args.payload)
      if (rendered) outgoing = { ...rendered, to: targets.email }
    } else if (targets.email) {
      await tx.notificationDelivery.create({
        data: {
          eventId: created.id,
          userId: args.userId,
          channel: 'EMAIL',
          targetEmail: targets.email,
        },
      })
    }

    for (const sub of targets.pushSubscriptions) {
      await tx.notificationDelivery.create({
        data: {
          eventId: created.id,
          userId: args.userId,
          channel: 'WEB_PUSH',
          targetSubscriptionId: sub.id,
        },
      })
    }

    return { event: created, syncEmail: outgoing }
  })

  if (syncEmail) {
    await sendMailNow(syncEmail as never)
  }

  return event
}
