'use client'

import '@excalidraw/excalidraw/index.css'

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement, Theme } from '@excalidraw/excalidraw/element/types'
import { Box, useTheme } from '@mui/material'
import { ExcalidrawBinding, yjsToExcalidraw } from '@timephy/y-excalidraw'

import { FilesHandler, type ExcalidrawFile } from './files-handler'
import type { BoardProps } from './types'
import { useExcalidrawYjs } from './use-excalidraw-yjs'

export function BoardInner(props: BoardProps) {
  const {
    pageId,
    yjsUrl,
    yjsToken,
    initialContentYjs,
    uploadHandler,
    user,
    editable = true,
    className,
  } = props

  const muiTheme = useTheme()
  const excalidrawTheme: Theme = muiTheme.palette.mode === 'dark' ? 'dark' : 'light'

  // Decode initialContentYjs synchronously so Excalidraw's scene is populated
  // by the time ExcalidrawBinding is constructed. The binding seeds
  // `lastKnownElements` from yElements but reads `getSceneElements()` later;
  // if the scene is still empty when an `onChange` fires, the diff yields a
  // spurious DELETE that wipes the loaded drawing.
  const initialData = useMemo(() => {
    if (!initialContentYjs) return null
    const tmpDoc = new Y.Doc()
    const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
    Y.applyUpdate(tmpDoc, bytes)
    const elements = yjsToExcalidraw(tmpDoc.getArray('elements')).filter(
      (el) => Object.keys(el).length > 0,
    )
    const files: BinaryFiles = {}
    tmpDoc.getMap<BinaryFiles[string]>('assets').forEach((value, key) => {
      files[key] = value
    })
    tmpDoc.destroy()
    return { elements, files }
  }, [initialContentYjs])

  const resources = useExcalidrawYjs({ pageId, yjsUrl, yjsToken, initialContentYjs })

  useEffect(() => {
    if (!user || !resources) return
    resources.provider.awareness?.setLocalStateField('user', {
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
        width: '100%',
        height: '100%',
        minHeight: 0,
        position: 'relative',
      }}
    >
      <Excalidraw
        excalidrawAPI={onMount}
        viewModeEnabled={!editable}
        theme={excalidrawTheme}
        onChange={onChange}
        initialData={initialData}
      />
    </Box>
  )
}
