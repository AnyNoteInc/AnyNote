"use client"

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

  return <span suppressHydrationWarning>{LOADING_PHRASES[index]}</span>
}
