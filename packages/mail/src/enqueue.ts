import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@repo/db'
import type { MailKind, MailPayloads } from './types.ts'

export type EnqueueMailEventArgs<K extends MailKind> = {
  kind: K
  to: string
  data: MailPayloads[K]
  userId?: string
}

export async function enqueueMailEvent<K extends MailKind>(
  prisma: PrismaClient,
  args: EnqueueMailEventArgs<K>,
): Promise<void> {
  const aggregateId = args.userId || randomUUID()
  await prisma.outboxEvent.create({
    data: {
      aggregateType: 'email',
      aggregateId,
      eventType: 'email.send',
      payload: { kind: args.kind, to: args.to, data: args.data },
    },
  })
}
