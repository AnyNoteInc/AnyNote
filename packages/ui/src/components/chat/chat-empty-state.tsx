'use client'

import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

export const CHAT_EMPTY_PHRASES = [
  'Над чем ты работаешь?',
  'Что у тебя сегодня на уме?',
  'С чего начнём?',
  'Готов, когда ты готов',
] as const

function pickPhrase(): string {
  const index = Math.floor(Math.random() * CHAT_EMPTY_PHRASES.length)
  // index is always in-bounds; the fallback only satisfies noUncheckedIndexedAccess.
  return CHAT_EMPTY_PHRASES[index] ?? CHAT_EMPTY_PHRASES[0]
}

export function ChatEmptyState() {
  // SSR-safe random: render empty on first paint, choose on mount (matches
  // ChatLoadingPhrases). Avoids a server/client text hydration mismatch.
  const [phrase, setPhrase] = useState<string>('')
  useEffect(() => {
    setPhrase(pickPhrase())
  }, [])

  return (
    <Typography
      align="center"
      component="h2"
      suppressHydrationWarning
      sx={{ fontWeight: 400, px: 3 }}
      variant="h5"
    >
      {phrase}
    </Typography>
  )
}
