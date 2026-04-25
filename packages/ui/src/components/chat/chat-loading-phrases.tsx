"use client"

import Typography from "@mui/material/Typography"
import { useEffect, useState } from "react"

const LOADING_PHRASES = ["Загрузка", "Вычисления", "Преобразование", "Литье"] as const
const PHRASE_INTERVAL_MS = 1000

export function ChatLoadingPhrases() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % LOADING_PHRASES.length)
    }, PHRASE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <Typography color="text.secondary" suppressHydrationWarning variant="body2">
      {LOADING_PHRASES[index]}
    </Typography>
  )
}
