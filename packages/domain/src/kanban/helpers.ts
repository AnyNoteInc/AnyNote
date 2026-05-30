export const POSITION_GAP = 1024
const PRECISION_FLOOR = Number.EPSILON * 1024

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
