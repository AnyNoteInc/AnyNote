'use client'

import { FormControl, InputLabel, MenuItem, Select } from '@repo/ui/components'

// Mirror of the dto `NumberFormat` enum — redefined client-side so we never import
// the dto runtime (which drags the @repo/db/pg adapter into the client bundle).
export type NumberFormat = 'plain' | 'integer' | 'decimal' | 'percent' | 'currency_rub'

const FORMAT_LABELS: ReadonlyArray<{ value: NumberFormat; label: string }> = [
  { value: 'plain', label: 'Обычное' },
  { value: 'integer', label: 'Целое' },
  { value: 'decimal', label: 'Десятичное (2 знака)' },
  { value: 'percent', label: 'Процент' },
  { value: 'currency_rub', label: 'Рубли ₽' },
]

interface NumberFormatPickerProps {
  readonly value: NumberFormat | undefined
  readonly onChange: (next: NumberFormat) => void
  readonly disabled?: boolean
}

/**
 * Picks the display format for a NUMBER property (`settings.numberFormat`). The
 * value is purely presentational — cells still store a plain number; the
 * computed/number cell renderers format per this setting.
 */
export function NumberFormatPicker({ value, onChange, disabled }: NumberFormatPickerProps) {
  return (
    <FormControl size="small" fullWidth disabled={disabled}>
      <InputLabel id="number-format-label">Формат числа</InputLabel>
      <Select
        labelId="number-format-label"
        label="Формат числа"
        value={value ?? 'plain'}
        onChange={(e) => onChange(e.target.value as NumberFormat)}
      >
        {FORMAT_LABELS.map((f) => (
          <MenuItem key={f.value} value={f.value}>
            {f.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
