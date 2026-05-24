'use client'

import { useEffect, useRef } from 'react'
import { AppBar, Box, Button, Dialog, Toolbar, Typography } from '@mui/material'
import {
  DrawIoEmbed,
  type DrawIoEmbedRef,
  type EventAutoSave,
  type EventExport,
} from 'react-drawio'

import { finalizeDrawioSave, type DrawioNodeAttrs } from '../extensions/drawio-save'

type Props = {
  open: boolean
  initialXml: string
  drawioUrl: string
  onSave: (attrs: DrawioNodeAttrs) => void
  onCancel: () => void
}

export function DrawioEditorDialog({ open, initialXml, drawioUrl, onSave, onCancel }: Props) {
  const drawioRef = useRef<DrawIoEmbedRef>(null)
  const latestXml = useRef(initialXml)

  useEffect(() => {
    if (open) latestXml.current = initialXml
  }, [initialXml, open])

  const handleSave = () => {
    drawioRef.current?.exportDiagram({ format: 'xmlsvg' })
  }

  const handleAutoSave = (data: EventAutoSave) => {
    latestXml.current = data.xml
  }

  const handleExport = (data: EventExport) => {
    onSave(
      finalizeDrawioSave({
        latestXml: latestXml.current || data.xml,
        initialXml,
        exportData: data.data,
      }),
    )
  }

  return (
    <Dialog open={open} onClose={onCancel} fullScreen sx={{ '& .MuiDialog-paper': { display: 'flex' } }}>
      <AppBar position="relative" color="default" elevation={1}>
        <Toolbar variant="dense">
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Draw.io
          </Typography>
          <Button onClick={onCancel}>Отмена</Button>
          <Button onClick={handleSave} variant="contained" sx={{ ml: 1 }}>
            Сохранить
          </Button>
        </Toolbar>
      </AppBar>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          '& iframe': { border: 0, width: '100%', height: '100%' },
        }}
      >
        {open ? (
          <DrawIoEmbed
            ref={drawioRef}
            baseUrl={drawioUrl}
            autosave
            xml={initialXml || undefined}
            exportFormat="xmlsvg"
            urlParameters={{ spin: true, noSaveBtn: true, noExitBtn: true }}
            onAutoSave={handleAutoSave}
            onExport={handleExport}
          />
        ) : null}
      </Box>
    </Dialog>
  )
}
