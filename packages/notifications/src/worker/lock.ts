import { Prisma, type PrismaClient } from '@repo/db'

export async function lockPendingDeliveries(
  prisma: PrismaClient,
  args: { workerId: string; batchSize: number },
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM notification_deliveries
      WHERE status = 'PENDING'
        AND next_attempt_at <= now()
        AND locked_at IS NULL
      ORDER BY next_attempt_at
      LIMIT ${args.batchSize}
      FOR UPDATE SKIP LOCKED
    `)
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    await tx.notificationDelivery.updateMany({
      where: { id: { in: ids } },
      data: { lockedAt: new Date(), lockedBy: args.workerId },
    })
    return ids
  })
}
