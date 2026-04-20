"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { chatTokens } from "../theme/tokens"

export interface UseAutoScrollOptions {
  /** Distance from bottom (px) within which we consider the view "pinned". */
  threshold?: number
}

export interface UseAutoScrollResult<T extends HTMLElement = HTMLDivElement> {
  containerRef: React.RefObject<T | null>
  isPinned: boolean
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  options: UseAutoScrollOptions = {},
): UseAutoScrollResult<T> {
  const threshold = options.threshold ?? chatTokens.scrollPinThresholdPx
  const containerRef = useRef<T | null>(null)
  const [isPinned, setIsPinned] = useState(true)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const onScroll = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setIsPinned(distanceFromBottom <= threshold)
    }
    onScroll()
    node.addEventListener("scroll", onScroll, { passive: true })
    return () => node.removeEventListener("scroll", onScroll)
  }, [threshold])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = containerRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior })
  }, [])

  return { containerRef, isPinned, scrollToBottom }
}
