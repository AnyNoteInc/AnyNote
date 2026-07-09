import { MenuItem, Stack, TextField } from '@mui/material'
import { useState, useEffect } from 'react'
import type { PartialDate } from '../../types/domain'
import { RU } from '../../i18n/ru'

interface Props {
  value: PartialDate
  onChange: (next: PartialDate) => void
  label?: string
}

function useNumberField(
  externalValue: number | undefined,
  onCommit: (n: number | undefined) => void,
) {
  const [text, setText] = useState(externalValue !== undefined ? String(externalValue) : '')

  useEffect(() => {
    setText(externalValue !== undefined ? String(externalValue) : '')
  }, [externalValue])

  const handleChange = (raw: string) => {
    setText(raw)
    const parsed = raw === '' ? undefined : Number(raw)
    const n = parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined
    onCommit(n)
  }

  return { value: text, onChange: handleChange }
}

export function PartialDateInput({ value, onChange, label }: Props) {
  const update = (patch: Partial<PartialDate>) => {
    const next: PartialDate = { ...value, ...patch }
    if (next.day === undefined) delete next.day
    if (next.month === undefined) delete next.month
    if (next.year === undefined) delete next.year
    onChange(next)
  }

  const dayField = useNumberField(value.day, (n) => update({ day: n }))
  const yearField = useNumberField(value.year, (n) => update({ year: n }))

  return (
    <Stack spacing={1}>
      {label && <span>{label}</span>}
      <Stack direction="row" spacing={1}>
        <TextField
          label="День"
          type="number"
          size="small"
          value={dayField.value}
          slotProps={{ htmlInput: { min: 1, max: 31, inputMode: 'numeric' } }}
          onChange={(e) => dayField.onChange(e.target.value)}
        />
        <TextField
          select
          label="Месяц"
          size="small"
          value={value.month ?? ''}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value)
            update({ month: n })
          }}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="">—</MenuItem>
          {RU.months.nominative.map((m, idx) => (
            <MenuItem key={m} value={idx + 1}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Год"
          type="number"
          size="small"
          value={yearField.value}
          slotProps={{ htmlInput: { min: 1700, max: 2200, inputMode: 'numeric' } }}
          onChange={(e) => yearField.onChange(e.target.value)}
        />
      </Stack>
    </Stack>
  )
}
