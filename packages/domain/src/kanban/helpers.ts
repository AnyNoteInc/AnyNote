import type { Prisma, TaskActivityType } from '@repo/db'
import { z } from 'zod'

export const POSITION_GAP = 1024
const PRECISION_FLOOR = Number.EPSILON * 1024

export const dateInput = z
  .preprocess((v) => {
    if (v === null || v === undefined) return v
    if (v instanceof Date) return v
    if (typeof v === 'string') {
      const parsed = new Date(v)
      return Number.isNaN(parsed.getTime()) ? v : parsed
    }
    return v
  }, z.date().nullable())
  .optional()

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) {
    const gap = next - prev
    if (gap < PRECISION_FLOOR) throw new Error('Position precision underflow — rebalance required')
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

export async function recordActivity(
  tx: Prisma.TransactionClient,
  input: { taskId: string; actorId: string; type: TaskActivityType; payload?: Prisma.InputJsonValue },
): Promise<void> {
  await tx.taskActivity.create({
    data: { taskId: input.taskId, actorId: input.actorId, type: input.type, payload: input.payload ?? undefined },
  })
}
