const POSITION_GAP = 1024

export function positionBetween(prev: number | null, next: number | null): number {
  if (prev !== null && next !== null) return prev + (next - prev) / 2
  if (prev !== null) return prev + POSITION_GAP
  if (next !== null) return next - POSITION_GAP
  return 0
}
