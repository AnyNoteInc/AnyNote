'use client'

import { Box, Popover } from '@repo/ui/components'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useState } from 'react'

import type { SlashRange, VirtualAnchor } from '../types'
import { DatePickerBody } from './date-picker-body'

type Props = {
  open: boolean
  mode: 'date' | 'datetime'
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  onClose: () => void
}

export function DateInsertPopover({ open, mode, anchorEl, range, editor, onClose }: Props) {
  const [value, setValue] = useState<Date | null>(() => new Date())

  useEffect(() => {
    if (open) setValue(new Date())
  }, [open])

  const insert = useCallback(
    (date: Date | null) => {
      if (!range) return
      const selected = date ?? new Date()
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'date',
          attrs: { value: selected.toISOString(), kind: mode },
        })
        .insertContent(' ')
        .run()
      onClose()
    },
    [editor, mode, onClose, range],
  )

  return (
    <Popover
      open={open}
      anchorEl={anchorEl as Element | null}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 332, maxWidth: 'calc(100vw - 32px)' } } }}
    >
      <Box>
        <DatePickerBody
          mode={mode}
          value={value}
          onChange={setValue}
          onAccept={insert}
          onCancel={onClose}
          confirmLabel="Вставить"
        />
      </Box>
    </Popover>
  )
}
