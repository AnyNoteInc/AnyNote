'use client'

import { Box, Popover } from '@repo/ui/components'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useState } from 'react'

import { DatePickerBody } from '../components/date-picker-body'
import { formatIsoForDisplay } from '../lib/date-format'
import { DateSchema, type DateKind, type DateNodeAttrs } from './date.schema'

function DateView({ node, updateAttributes, editor }: NodeViewProps) {
  const attrs = node.attrs as DateNodeAttrs
  const kind: DateKind = attrs.kind === 'datetime' ? 'datetime' : 'date'
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState<Date | null>(null)

  const parsed = attrs.value ? new Date(attrs.value) : null
  const current = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()

  const open = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!editor.isEditable) return
    setDraft(current)
    setAnchor(event.currentTarget)
  }

  const close = () => setAnchor(null)

  const accept = (value: Date | null) => {
    const next = value ?? current
    updateAttributes({ value: next.toISOString() })
    close()
  }

  const label = attrs.value ? formatIsoForDisplay(attrs.value, kind) : 'Выбрать дату'

  return (
    <NodeViewWrapper
      as="span"
      className="anynote-date-wrapper"
      contentEditable={false}
      data-type="date"
      data-kind={kind}
    >
      <Box
        component="span"
        onClick={open}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.5,
          mx: 0.25,
          borderRadius: 0.75,
          color: 'primary.main',
          cursor: editor.isEditable ? 'pointer' : 'default',
          backgroundColor: 'action.hover',
          transition: 'background-color .15s',
          '&:hover': { backgroundColor: editor.isEditable ? 'action.selected' : 'action.hover' },
        }}
      >
        {kind === 'datetime' ? (
          <AccessTimeIcon sx={{ fontSize: 14 }} />
        ) : (
          <CalendarTodayIcon sx={{ fontSize: 14 }} />
        )}
        <span>{label}</span>
      </Box>
      <Popover
        open={Boolean(anchor) && draft !== null}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 332, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <DatePickerBody
          mode={kind}
          value={draft}
          onChange={setDraft}
          onAccept={accept}
          onCancel={close}
          confirmLabel="Сохранить"
        />
      </Popover>
    </NodeViewWrapper>
  )
}

export const DateNode = DateSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DateView)
  },
})
