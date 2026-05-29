import type { Prisma } from '@repo/db'
export { POSITION_GAP, dateInput, endPosition, positionBetween, recordActivity } from '@repo/domain'

const DEFAULT_PRIORITY_COLORS = {
  low: '#6B7280',
  medium: '#3B82F6',
  high: '#F97316',
  critical: '#EF4444',
} as const

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
      { pageId, title: 'Низкий', color: DEFAULT_PRIORITY_COLORS.low, position: 1024 },
      { pageId, title: 'Средний', color: DEFAULT_PRIORITY_COLORS.medium, position: 2048 },
      { pageId, title: 'Высокий', color: DEFAULT_PRIORITY_COLORS.high, position: 3072 },
      { pageId, title: 'Критичный', color: DEFAULT_PRIORITY_COLORS.critical, position: 4096 },
    ],
  })
}
