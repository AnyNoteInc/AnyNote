'use client'

import {
  AdapterDateFns,
  Box,
  Button,
  LocalizationProvider,
  Popover,
  Stack,
  StaticDatePicker,
  dateFnsRu,
  datePickerRuRU,
} from '@repo/ui/components'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useState } from 'react'

import { formatDateText } from '../lib/date-format'
import type { SlashRange, VirtualAnchor } from '../types'

type Props = {
  open: boolean
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  onClose: () => void
}

export function DateInsertPopover({ open, anchorEl, range, editor, onClose }: Props) {
  const [value, setValue] = useState<Date | null>(() => new Date())

  useEffect(() => {
    if (open) setValue(new Date())
  }, [open])

  const insertDate = useCallback(
    (date: Date | null) => {
      if (!range) return
      const selectedDate = date ?? new Date()
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent(`${formatDateText(selectedDate)} `)
        .run()
      onClose()
    },
    [editor, onClose, range],
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
          <StaticDatePicker
            value={value}
            onChange={(nextValue) => setValue(nextValue)}
            onAccept={(acceptedValue) => insertDate(acceptedValue)}
            onClose={onClose}
            displayStaticWrapperAs="desktop"
            slotProps={{ actionBar: { actions: [] } }}
          />
        </LocalizationProvider>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 2, pb: 2 }}>
          <Button size="small" onClick={onClose}>
            Отмена
          </Button>
          <Button size="small" variant="contained" onClick={() => insertDate(value)}>
            Вставить дату
          </Button>
        </Stack>
      </Box>
    </Popover>
  )
}
