import type { PrismaClient } from '@repo/db'

import { badRequest, conflict, notFound } from '../errors.ts'
import { assertPageOwnership } from './access.ts'
import { endPosition } from './helpers.ts'
import type { CompleteSprintInput, CreateSprintInput, SprintIdInput } from './schemas.ts'

export async function createSprint(prisma: PrismaClient, actorUserId: string, input: CreateSprintInput) {
  const page = await assertPageOwnership(prisma, actorUserId, input.pageId)
  const existing = await prisma.sprint.findMany({ where: { pageId: page.id }, select: { position: true } })
  return prisma.sprint.create({
    data: {
      pageId: page.id,
      name: input.name,
      description: input.description ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      status: 'PLANNED',
      position: endPosition(existing),
    },
  })
}

export async function activateSprint(prisma: PrismaClient, actorUserId: string, input: SprintIdInput) {
  const page = await assertPageOwnership(prisma, actorUserId, input.pageId)
  try {
    await prisma.$transaction(async (tx) => {
      await tx.sprint.updateMany({ where: { pageId: page.id, status: 'ACTIVE', NOT: { id: input.id } }, data: { status: 'PLANNED' } })
      await tx.sprint.update({ where: { id: input.id, pageId: page.id }, data: { status: 'ACTIVE' } })
    })
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') throw conflict('Активный спринт уже существует — попробуйте ещё раз')
    throw e
  }
  return { ok: true as const }
}

export async function completeSprint(prisma: PrismaClient, actorUserId: string, input: CompleteSprintInput) {
  const page = await assertPageOwnership(prisma, actorUserId, input.pageId)
  if (input.moveUndoneTo === input.id) throw badRequest('Невозможно перенести задачи в тот же спринт')
  await prisma.$transaction(async (tx) => {
    const [sprint, dest, undoneColumns] = await Promise.all([
      tx.sprint.findUnique({ where: { id: input.id }, select: { id: true, pageId: true } }),
      input.moveUndoneTo ? tx.sprint.findUnique({ where: { id: input.moveUndoneTo }, select: { id: true, pageId: true } }) : Promise.resolve(null),
      tx.kanbanColumn.findMany({ where: { pageId: page.id, kind: 'ACTIVE' }, select: { id: true } }),
    ])
    if (!sprint || sprint.pageId !== page.id) throw notFound('Спринт не найден')
    if (input.moveUndoneTo && (!dest || dest.pageId !== page.id)) throw notFound('Целевой спринт не найден на этой доске')
    const undoneColumnIds = undoneColumns.map((c) => c.id)
    await tx.task.updateMany({ where: { sprintId: input.id, columnId: { in: undoneColumnIds } }, data: { sprintId: input.moveUndoneTo, sprintPosition: null } })
    await tx.sprint.update({ where: { id: input.id }, data: { status: 'COMPLETED' } })
  })
  return { ok: true as const }
}
