// Smallest share a column on either side of a divider may shrink to,
// expressed as a fraction of the pair's combined width. With sum=2 and
// MIN_WIDTH_FRACTION=0.1, each neighbor stays >= 0.2 share.
export const MIN_WIDTH_FRACTION = 0.1

export function computeResizedWidths(
  left: number,
  right: number,
  deltaFraction: number,
  minFraction: number,
): { left: number; right: number } {
  const sum = left + right
  const min = sum * minFraction
  const max = sum - min
  const proposedLeft = left + deltaFraction
  const clampedLeft = Math.max(min, Math.min(max, proposedLeft))
  return { left: clampedLeft, right: sum - clampedLeft }
}
