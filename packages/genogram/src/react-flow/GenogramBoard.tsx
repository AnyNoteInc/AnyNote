"use client"

import { useEffect, type CSSProperties } from "react"
import { useGenogramYjs } from "../hooks/useGenogramYjs"
import { GenogramFlow, type GenogramMode } from "./GenogramFlow"

export interface GenogramBoardProps {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  user?: { id: string; name: string; color: string }
  mode?: GenogramMode
  className?: string
  style?: CSSProperties
}

/**
 * Drop-in collaborative renderer for a GENOGRAM page. Mirrors the Board /
 * AnyNoteEditor pattern: owns the Y.Doc + HocuspocusProvider lifecycle,
 * publishes awareness, and renders GenogramFlow against the live doc.
 */
export function GenogramBoard({
  pageId,
  yjsUrl,
  yjsToken,
  user,
  mode = "editor",
  className,
  style,
}: GenogramBoardProps) {
  const resources = useGenogramYjs({ pageId, yjsUrl, yjsToken })

  useEffect(() => {
    if (!resources || !user) return
    resources.provider.awareness?.setLocalStateField("user", {
      name: user.name,
      color: user.color,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, user?.name, user?.color])

  useEffect(() => {
    if (!resources) return
    if (typeof window === "undefined") return
    if (process.env.NODE_ENV !== "development") return
    ;(window as unknown as { __genogramDoc?: unknown }).__genogramDoc = resources.ydoc
    return () => {
      const w = window as unknown as { __genogramDoc?: unknown }
      if (w.__genogramDoc === resources.ydoc) delete w.__genogramDoc
    }
  }, [resources])

  if (!resources) return null

  return (
    <GenogramFlow
      yDoc={resources.ydoc}
      mode={mode}
      className={className}
      style={style}
    />
  )
}
