import type { PrismaClient } from '@repo/db'

import { badRequest } from '../errors.ts'
import type { MarkReadInput } from './schemas.ts'

export async function markRead(
  prisma: PrismaClient,
  actorUserId: string,
  input: MarkReadInput,
): Promise<{ updated: number }> {
  // markReadInput validates min(1) — guard defensively so the domain is self-protecting
  if (input.ids.length === 0) throw badRequest('ids must not be empty')
  const result = await prisma.notificationInApp.updateMany({
    where: { userId: actorUserId, id: { in: input.ids }, readAt: null },
    data: { readAt: new Date() },
  })
  return { updated: result.count }
}

export async function markAllRead(
  prisma: PrismaClient,
  actorUserId: string,
): Promise<{ updated: number }> {
  const result = await prisma.notificationInApp.updateMany({
    where: { userId: actorUserId, readAt: null },
    data: { readAt: new Date() },
  })
  return { updated: result.count }
}

export async function deleteAll(
  prisma: PrismaClient,
  actorUserId: string,
): Promise<{ deleted: number }> {
  const result = await prisma.notificationInApp.deleteMany({
    where: { userId: actorUserId },
  })
  return { deleted: result.count }
}
