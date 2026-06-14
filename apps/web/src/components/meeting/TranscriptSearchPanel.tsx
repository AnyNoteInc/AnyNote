'use client'

import { useEffect, useMemo, useState } from 'react'

import type { MeetingSegment } from '@repo/trpc'
import {
  Box,
  GraphicEqIcon,
  InputBase,
  List,
  ListItemButton,
  Typography,
} from '@repo/ui/components'

import { HighlightMatches } from '@/components/search/highlight-matches'

import { filterSegments } from './filter-segments'
import { formatTimestamp, segmentDomId } from './segment-utils'

const DEBOUNCE_MS = 150
const MAX_QUERY = 200

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = globalThis.setTimeout(() => setDebounced(value), delayMs)
    return () => globalThis.clearTimeout(timeout)
  }, [delayMs, value])
  return debounced
}

type Props = Readonly<{ segments: MeetingSegment[] }>

/**
 * Client-side transcript search. A debounced query filters the in-memory
 * `segments` (no tRPC roundtrip — they are already loaded via meeting.getByPage);
 * clicking a result scrolls the matching transcript segment into view and flashes
 * it. Empty query → no result list (the full transcript is shown by the parent).
 */
export function TranscriptSearchPanel({ segments }: Props) {
  const [raw, setRaw] = useState('')
  const trimmed = raw.trim().slice(0, MAX_QUERY)
  const query = useDebouncedValue(trimmed, DEBOUNCE_MS)

  const results = useMemo(() => (query ? filterSegments(segments, query) : []), [segments, query])

  const scrollToSegment = (segmentId: string) => {
    const el = document.getElementById(segmentDomId(segmentId))
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('transcript-segment-flash')
    globalThis.setTimeout(() => el.classList.remove('transcript-segment-flash'), 1500)
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          px: 1.25,
          py: 0.5,
        }}
      >
        <GraphicEqIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <InputBase
          fullWidth
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Поиск по расшифровке"
          inputProps={{ 'aria-label': 'Поиск по расшифровке', 'data-testid': 'transcript-search' }}
        />
      </Box>

      {query ? (
        <Box sx={{ mt: 1 }}>
          {results.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
              Ничего не найдено
            </Typography>
          ) : (
            <List dense disablePadding sx={{ maxHeight: 240, overflow: 'auto' }}>
              {results.map((s) => (
                <ListItemButton
                  key={s.id}
                  data-testid="transcript-search-result"
                  onClick={() => scrollToSegment(s.id)}
                  sx={{ alignItems: 'flex-start', gap: 1, borderRadius: 1 }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', pt: 0.25 }}
                  >
                    {formatTimestamp(s.startMs)}
                  </Typography>
                  <Typography variant="body2" sx={{ minWidth: 0 }}>
                    {s.speaker ? (
                      <Box component="span" sx={{ fontWeight: 600, mr: 0.5 }}>
                        {s.speaker}:
                      </Box>
                    ) : null}
                    <HighlightMatches text={s.text} query={query} />
                  </Typography>
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      ) : null}
    </Box>
  )
}
