import type { PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import { assertPageAccess } from './access.ts'
import { recordActivity } from './helpers.ts'
import type { CreateTaskCommentInput } from './schemas.ts'

export async function createTaskComment(prisma: PrismaClient, actorUserId: string, input: CreateTaskCommentInput) {
  await assertPageAccess(prisma, actorUserId, input.pageId)
  const task = await prisma.task.findUniqueOrThrow({ where: { id: input.taskId }, select: { pageId: true } })
  if (task.pageId !== input.pageId) throw notFound('Задача не найдена')
  return prisma.$transaction(async (tx) => {
    const created = await tx.taskComment.create({ data: { taskId: input.taskId, authorId: actorUserId, content: input.content as never } })
    await recordActivity(tx, { taskId: input.taskId, actorId: actorUserId, type: 'COMMENTED', payload: { commentId: created.id } })
    return created
  })
}
