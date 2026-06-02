'use client'

import {
  AdapterDateFns,
  Box,
  Button,
  LocalizationProvider,
  Popover,
  Stack,
  StaticDatePicker,
  StaticDateTimePicker,
  dateFnsRu,
  datePickerRuRU,
} from '@repo/ui/components'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useState } from 'react'

import type { SlashRange, VirtualAnchor } from '../types'

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
        <LocalizationProvider
          dateAdapter={AdapterDateFns}
          adapterLocale={dateFnsRu}
          localeText={datePickerRuRU.components.MuiLocalizationProvider.defaultProps.localeText}
        >
          {mode === 'datetime' ? (
            <StaticDateTimePicker
              value={value}
              onChange={(next) => setValue(next)}
              onAccept={(accepted) => insert(accepted)}
              onClose={onClose}
              displayStaticWrapperAs="desktop"
              slotProps={{ actionBar: { actions: [] } }}
            />
          ) : (
            <StaticDatePicker
              value={value}
              onChange={(next) => setValue(next)}
              onAccept={(accepted) => insert(accepted)}
              onClose={onClose}
              displayStaticWrapperAs="desktop"
              slotProps={{ actionBar: { actions: [] } }}
            />
          )}
        </LocalizationProvider>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 2, pb: 2 }}>
          <Button size="small" onClick={onClose}>
            Отмена
          </Button>
          <Button size="small" variant="contained" onClick={() => insert(value)}>
            Вставить
          </Button>
        </Stack>
      </Box>
    </Popover>
  )
}
