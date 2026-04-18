"use client"

import "@excalidraw/excalidraw/index.css"
import "./board.css"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Excalidraw } from "@excalidraw/excalidraw"
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import type { OrderedExcalidrawElement, Theme } from "@excalidraw/excalidraw/element/types"
import { Box, useTheme } from "@mui/material"
import { ExcalidrawBinding } from "@timephy/y-excalidraw"

import { FilesHandler, type ExcalidrawFile } from "./files-handler"
import type { BoardProps } from "./types"
import { useExcalidrawYjs } from "./use-excalidraw-yjs"

const DARK_BG = "#121212"
const LIGHT_BG = "#ffffff"
const DARK_STROKE = "#ffffff"
const LIGHT_STROKE = "#1e1e1e"

export function BoardInner(props: BoardProps) {
  const { pageId, yjsUrl, yjsToken, uploadHandler, user, editable = true, className } = props

  const muiTheme = useTheme()
  const excalidrawTheme: Theme = muiTheme.palette.mode === "dark" ? "dark" : "light"
  const isDark = muiTheme.palette.mode === "dark"
  const viewBackgroundColor = isDark ? DARK_BG : LIGHT_BG
  const currentItemStrokeColor = isDark ? DARK_STROKE : LIGHT_STROKE

  const initialModeRef = useRef(muiTheme.palette.mode)
  const initialData = useMemo(
    () => ({
      appState: {
        viewBackgroundColor: initialModeRef.current === "dark" ? DARK_BG : LIGHT_BG,
        currentItemStrokeColor:
          initialModeRef.current === "dark" ? DARK_STROKE : LIGHT_STROKE,
      },
    }),
    [],
  )

  const resources = useExcalidrawYjs({ pageId, yjsUrl, yjsToken })

  useEffect(() => {
    if (!user || !resources) return
    resources.provider.awareness?.setLocalStateField("user", {
      name: user.name,
      color: user.color,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, user?.name, user?.color])

  const files = useMemo(() => new FilesHandler(uploadHandler), [uploadHandler])

  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  useEffect(() => {
    if (!api || !resources) return
    const binding = new ExcalidrawBinding(
      resources.yElements,
      resources.yAssets,
      api,
      resources.provider.awareness ?? undefined,
    )
    return () => {
      binding.destroy()
    }
  }, [api, resources])

  const onMount = useCallback((a: ExcalidrawImperativeAPI) => {
    setApi(a)
  }, [])

  // On theme change after mount, push the new canvas background. Scheduled on
  // a microtask so it runs after the binding's own scene updates, preventing
  // a race where our write is immediately followed by a Yjs-driven no-op that
  // undoes it.
  useEffect(() => {
    if (!api) return
    const id = window.setTimeout(() => {
      api.updateScene({
        appState: { viewBackgroundColor, currentItemStrokeColor },
        captureUpdate: "NEVER",
      })
    }, 0)
    return () => window.clearTimeout(id)
  }, [api, viewBackgroundColor, currentItemStrokeColor])

  const onChange = useCallback(
    (_elements: readonly OrderedExcalidrawElement[], _appState: AppState, fileMap: BinaryFiles) => {
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
      <Excalidraw
        excalidrawAPI={onMount}
        viewModeEnabled={!editable}
        theme={excalidrawTheme}
        initialData={initialData}
        onChange={onChange}
      />
    </Box>
  )
}
