import type { MeetingSegment } from '@repo/trpc'

/**
 * Pure, client-side transcript filter for the TranscriptSearchPanel. Returns the
 * segments whose `text` (or `speaker`) contains the trimmed query,
 * case-insensitively. An empty/whitespace query returns the segments unchanged
 * (the panel shows the full transcript). No tRPC roundtrip — the segments are
 * already in memory from `meeting.getByPage`.
 */
export function filterSegments(segments: MeetingSegment[], query: string): MeetingSegment[] {
  const q = query.trim().toLowerCase()
  if (!q) return segments
  return segments.filter((s) => {
    const haystack = `${s.speaker ?? ''} ${s.text}`.toLowerCase()
    return haystack.includes(q)
  })
}
