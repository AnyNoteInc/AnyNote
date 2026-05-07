'use client'

import { Box, Button, Popover, Stack, TextField } from '@mui/material'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useState } from 'react'

import { dateFromInputValue, formatDateText, toDateInputValue } from '../lib/date-format'
import type { SlashRange, VirtualAnchor } from '../types'

type Props = {
  open: boolean
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  onClose: () => void
}

export function DateInsertPopover({ open, anchorEl, range, editor, onClose }: Props) {
  const [value, setValue] = useState(() => toDateInputValue(new Date()))

  useEffect(() => {
    if (open) setValue(toDateInputValue(new Date()))
  }, [open])

  const insertDate = useCallback(() => {
    if (!range) return
    const date = dateFromInputValue(value) ?? new Date()
    editor.chain().focus().deleteRange(range).insertContent(`${formatDateText(date)} `).run()
    onClose()
  }, [editor, onClose, range, value])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        insertDate()
      }
    },
    [insertDate],
  )

  return (
    <Popover
      open={open}
      anchorEl={anchorEl as Element | null}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 300 } } }}
    >
      <Box sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <TextField
            autoFocus
            label="Дата"
            type="date"
            size="small"
            value={value}
            fullWidth
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" onClick={onClose}>
              Отмена
            </Button>
            <Button size="small" variant="contained" onClick={insertDate}>
              Вставить дату
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Popover>
  )
}
