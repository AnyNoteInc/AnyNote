"use client"

import "@excalidraw/excalidraw/index.css"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Excalidraw } from "@excalidraw/excalidraw"
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import { Box } from "@mui/material"
import { ExcalidrawBinding } from "@timephy/y-excalidraw"

import { FilesHandler, type ExcalidrawFile } from "./files-handler"
import type { BoardProps } from "./types"
import { useExcalidrawYjs } from "./use-excalidraw-yjs"

export function BoardInner(props: BoardProps) {
  const { pageId, yjsUrl, yjsToken, uploadHandler, user, editable = true, className } = props

  const { provider, yElements, yAssets } = useExcalidrawYjs({
    pageId,
    yjsUrl,
    yjsToken,
  })

  // Publish the local user's identity through the Yjs awareness channel so
  // remote clients can render collaborator cursors/labels correctly.
  useEffect(() => {
    if (!user) return
    provider.awareness?.setLocalStateField("user", {
      name: user.name,
      color: user.color,
    })
    // Only re-publish when the visible user identity actually changes —
    // new `user` object identities on each render would otherwise churn awareness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, user?.name, user?.color])

  const files = useMemo(() => new FilesHandler(uploadHandler), [uploadHandler])

  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  // Binding requires the live imperative API, available only after onMount.
  useEffect(() => {
    if (!api) return
    const binding = new ExcalidrawBinding(yElements, yAssets, api, provider.awareness ?? undefined)
    return () => {
      binding.destroy()
    }
  }, [api, yElements, yAssets, provider])

  const onMount = useCallback((a: ExcalidrawImperativeAPI) => {
    setApi(a)
  }, [])

  const onChange = useCallback(
    (_elements: readonly OrderedExcalidrawElement[], _appState: AppState, fileMap: BinaryFiles) => {
      // Upload newly-added images through the consumer-provided handler.
      void files.syncFiles(fileMap as unknown as Record<string, ExcalidrawFile>)
    },
    [files],
  )

  return (
    <Box
      className={className}
      sx={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        position: "relative",
      }}
    >
      <Excalidraw excalidrawAPI={onMount} viewModeEnabled={!editable} onChange={onChange} />
    </Box>
  )
}
