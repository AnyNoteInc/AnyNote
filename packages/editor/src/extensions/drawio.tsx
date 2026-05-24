'use client'

import { useEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

import { DrawioEditorDialog } from '../components/drawio-editor-dialog'
import { DrawioViewerDialog } from '../components/drawio-viewer-dialog'
import { DrawioSchema } from './drawio.schema'
import type { DrawioNodeAttrs } from './drawio-save'

export type DrawioOptions = {
  drawioUrl: string
}

function DrawioView({ node, updateAttributes, extension, editor }: NodeViewProps) {
  const attrs = node.attrs as DrawioNodeAttrs
  const drawioUrl = (extension.options as DrawioOptions).drawioUrl
  const [view, setView] = useState<'idle' | 'viewer' | 'editor'>('idle')
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current)
    },
    [],
  )

  const handleClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => setView('viewer'), 250)
  }

  const handleDoubleClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    if (!editor.isEditable) return
    setView('editor')
  }

  return (
    <NodeViewWrapper
      as="div"
      className="anynote-drawio"
      data-type="drawio"
      data-drag-handle=""
      contentEditable={false}
    >
      <Box
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        sx={{
          cursor: 'pointer',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 1,
          my: 0.5,
          display: 'flex',
          justifyContent: 'center',
          minHeight: 80,
          '&:hover': { borderColor: 'text.secondary' },
        }}
      >
        {attrs.svg ? (
          <Box component="img" src={attrs.svg} alt="" sx={{ maxWidth: '100%' }} />
        ) : (
          <Box sx={{ color: 'text.secondary', fontSize: 13, py: 3 }}>
            Пустая диаграмма draw.io — двойной клик для редактирования
          </Box>
        )}
      </Box>
      <DrawioViewerDialog open={view === 'viewer'} svg={attrs.svg} onClose={() => setView('idle')} />
      <DrawioEditorDialog
        open={view === 'editor'}
        initialXml={attrs.xml}
        drawioUrl={drawioUrl}
        onSave={(next) => {
          updateAttributes(next)
          setView('idle')
        }}
        onCancel={() => setView('idle')}
      />
    </NodeViewWrapper>
  )
}

export const Drawio = DrawioSchema.extend<DrawioOptions>({
  addOptions() {
    return { drawioUrl: '' }
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawioView)
  },
})
