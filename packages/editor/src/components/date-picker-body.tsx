'use client'

import {
  AdapterDateFns,
  Box,
  Button,
  LocalizationProvider,
  Stack,
  StaticDatePicker,
  TimeField,
  dateFnsRu,
  datePickerRuRU,
} from '@repo/ui/components'

import type { DateKind } from '../extensions/date.schema'

type Props = {
  mode: DateKind
  value: Date | null
  onChange: (next: Date | null) => void
  onAccept: (accepted: Date | null) => void
  onCancel: () => void
  // Label for the confirm button — "Вставить" when inserting a new node,
  // "Сохранить" when editing an existing one.
  confirmLabel: string
}

// Shared ru-locale static date / datetime picker with a cancel/confirm footer.
// Used by both the slash-insert popover (DateInsertPopover) and the inline date
// node view (date.tsx) so the LocalizationProvider + picker wiring lives once.
export function DatePickerBody({ mode, value, onChange, onAccept, onCancel, confirmLabel }: Props) {
  return (
    <>
      <LocalizationProvider
        dateAdapter={AdapterDateFns}
        adapterLocale={dateFnsRu}
        localeText={datePickerRuRU.components.MuiLocalizationProvider.defaultProps.localeText}
      >
        {mode === 'datetime' ? (
          <Stack>
            <StaticDatePicker
              key="datetime-date"
              value={value}
              onChange={(d) => {
                if (!d) {
                  onChange(null)
                  return
                }
                // Keep the currently chosen time; only move the Y/M/D.
                const next = new Date(value ?? d)
                next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
                onChange(next)
              }}
              onAccept={onAccept}
              onClose={onCancel}
              displayStaticWrapperAs="desktop"
              slotProps={{ actionBar: { actions: [] } }}
            />
            <Box sx={{ px: 2, pb: 1 }}>
              <TimeField
                label="Время"
                value={value}
                onChange={(t) => {
                  if (!t) return
                  // Keep the currently chosen date; only set H/M.
                  const next = new Date(value ?? t)
                  next.setHours(t.getHours(), t.getMinutes(), 0, 0)
                  onChange(next)
                }}
                ampm={false}
                fullWidth
                size="small"
              />
            </Box>
          </Stack>
        ) : (
          <StaticDatePicker
            key="date"
            value={value}
            onChange={onChange}
            onAccept={onAccept}
            onClose={onCancel}
            displayStaticWrapperAs="desktop"
            slotProps={{ actionBar: { actions: [] } }}
          />
        )}
      </LocalizationProvider>
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 2, pb: 2 }}>
        <Button size="small" onClick={onCancel}>
          Отмена
        </Button>
        <Button size="small" variant="contained" onClick={() => onAccept(value)}>
          {confirmLabel}
        </Button>
      </Stack>
    </>
  )
}
