const POSITION_GAP = 1024
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
