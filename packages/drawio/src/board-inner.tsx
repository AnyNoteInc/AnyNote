'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Box } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { DrawIoEmbed, type DrawIoEmbedRef, type EventAutoSave } from 'react-drawio'
import type * as Y from 'yjs'

import { getDrawioThemeParameters } from './theme'
import { useDrawioYjs } from './use-drawio-yjs'
import { writeXmlToYText } from './sync'
import type { DrawioBoardProps } from './types'

export function DrawioBoardInner({
  pageId,
  yjsUrl,
  yjsToken,
  initialContentYjs,
  drawioUrl,
  className,
}: DrawioBoardProps) {
  const theme = useTheme()
  const resources = useDrawioYjs({ pageId, yjsUrl, yjsToken, initialContentYjs })
  const drawioRef = useRef<DrawIoEmbedRef>(null)
  const drawioThemeParameters = useMemo(
    () => getDrawioThemeParameters(theme.palette.mode),
    [theme.palette.mode],
  )
  // Read the stored XML once for the iframe's initial load. Remote updates after
  // mount are applied imperatively via load() in the observer below.
  const initialXml = useMemo(() => resources?.ytext.toString() ?? '', [resources])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reload the iframe when a *remote* peer saves. Our own debounced write runs in
  // a local transaction (writeXmlToYText), so tx.local === true filters it out and
  // we never reload from our own keystrokes.
  // Remote save → reload the iframe. With autosave on, a programmatic load of
  // unchanged content must NOT re-emit a save, or peers could ping-pong; the
  // 600ms debounce + last-writer-wins (spec) keep this convergent.
  useEffect(() => {
    if (!resources) return
    const { ytext } = resources
    const onChange = (_event: Y.YTextEvent, tx: Y.Transaction) => {
      if (tx.local) return
      drawioRef.current?.load({ xml: ytext.toString() })
    }
    ytext.observe(onChange)
    return () => ytext.unobserve(onChange)
  }, [resources])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    [],
  )

  if (!resources) return null

  const handleAutoSave = (data: EventAutoSave) => {
    const xml = data.xml
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      writeXmlToYText(resources.ydoc, resources.ytext, xml)
    }, 600)
  }

  return (
    <Box
      className={className}
      sx={{
        height: '100%',
        width: '100%',
        '& iframe': { border: 0, width: '100%', height: '100%' },
      }}
    >
      <DrawIoEmbed
        ref={drawioRef}
        baseUrl={drawioUrl}
        autosave
        xml={initialXml || undefined}
        urlParameters={{ ...drawioThemeParameters, spin: true, noExitBtn: true }}
        onAutoSave={handleAutoSave}
      />
    </Box>
  )
}
