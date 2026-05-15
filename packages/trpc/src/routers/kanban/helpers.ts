import type { Prisma, TaskActivityType } from '@repo/db'


export const POSITION_GAP = 1024
const PRECISION_FLOOR = Number.EPSILON * 1024

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) {
    const gap = next - prev
    if (gap < PRECISION_FLOOR) {
      throw new Error('Position precision underflow — rebalance required')
    }
    return prev + gap / 2
  }
  if (prev !== null) return prev + POSITION_GAP
  if (next !== null) return next - POSITION_GAP
  return 0
}

export function endPosition(items: { position: number }[]): number {
  let max: number | null = null
  for (const item of items) {
    if (max === null || item.position > max) max = item.position
  }
  return max === null ? 0 : max + POSITION_GAP
}

type TxClient = Prisma.TransactionClient

export async function seedKanbanDefaults(tx: TxClient, pageId: string): Promise<void> {
  await tx.kanbanColumn.createMany({
    data: [
      { pageId, title: 'Todo', kind: 'ACTIVE', position: 1024 },
      { pageId, title: 'In Progress', kind: 'ACTIVE', position: 2048 },
      { pageId, title: 'Done', kind: 'DONE', position: 3072 },
    ],
  })
  await tx.kanbanType.createMany({
    data: [
      { pageId, title: 'Задача', position: 1024 },
      { pageId, title: 'Баг', position: 2048 },
    ],
  })
  await tx.kanbanPriority.createMany({
    data: [
      { pageId, title: 'Highest', position: 1024 },
      { pageId, title: 'High', position: 2048 },
      { pageId, title: 'Medium', position: 3072 },
      { pageId, title: 'Low', position: 4096 },
      { pageId, title: 'Lowest', position: 5120 },
    ],
  })
}

export async function recordActivity(
  tx: TxClient,
  input: {
    taskId: string
    actorId: string
    type: TaskActivityType
    payload?: Prisma.InputJsonValue
  },
): Promise<void> {
  await tx.taskActivity.create({
    data: {
      taskId: input.taskId,
      actorId: input.actorId,
      type: input.type,
      payload: input.payload ?? undefined,
    },
  })
}
