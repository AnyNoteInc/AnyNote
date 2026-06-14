/** The DOM id for a transcript segment row, used for scroll-to from the search panel. */
export function segmentDomId(segmentId: string): string {
  return `transcript-segment-${segmentId}`
}

/**
 * Format a millisecond offset as `mm:ss` (or `h:mm:ss` past an hour). Used for the
 * transcript segment timestamps.
 */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}
