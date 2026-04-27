import { useState, useEffect, useRef } from 'react'
import { Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { ApproximateAge } from '../../types/domain'
import { RU } from '../../i18n/ru'

interface Props {
  value: ApproximateAge | undefined
  onChange: (next: ApproximateAge | undefined) => void
}

function useNumberField(externalValue: number | undefined, onCommit: (next: number | undefined) => void) {
  const [text, setText] = useState<string>(externalValue !== undefined ? String(externalValue) : '')
  useEffect(() => {
    setText(externalValue !== undefined ? String(externalValue) : '')
  }, [externalValue])
  const handleChange = (raw: string) => {
    setText(raw)
    const parsed = raw === '' ? undefined : Number(raw)
    const n = parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined
    onCommit(n)
  }
  return { text, handleChange }
}

export function ApproximateAgeInput({ value, onChange }: Props) {
  const [mode, setMode] = useState<'single' | 'range'>(
    value?.kind === 'range' ? 'range' : 'single',
  )

  const singleValue = value?.kind === 'value' ? value.value : undefined
  const fromValue = value?.kind === 'range' ? value.from : undefined
  const toValue = value?.kind === 'range' ? value.to : undefined

  // Keep mutable refs so the range field closures always read the latest committed sibling value.
  // We intentionally do NOT sync refs from props on every render — once committed locally they
  // stay until the parent passes a new controlled value.
  const fromRef = useRef<number | undefined>(fromValue)
  const toRef = useRef<number | undefined>(toValue)

  // When controlled value changes externally, sync refs (e.g. reset from parent)
  useEffect(() => { fromRef.current = fromValue }, [fromValue])
  useEffect(() => { toRef.current = toValue }, [toValue])

  const single = useNumberField(singleValue, (n) =>
    onChange(n === undefined ? undefined : { kind: 'value', value: n }),
  )
  const fromField = useNumberField(fromValue, (n) => {
    fromRef.current = n
    onChange(n === undefined ? undefined : { kind: 'range', from: n, to: toRef.current ?? 0 })
  })
  const toField = useNumberField(toValue, (n) => {
    toRef.current = n
    onChange(n === undefined ? undefined : { kind: 'range', from: fromRef.current ?? 0, to: n })
  })

  return (
    <Stack spacing={1}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        onChange={(_e, next: 'single' | 'range' | null) => {
          if (next) {
            setMode(next)
            onChange(undefined)
          }
        }}
      >
        <ToggleButton value="single">{RU.fields.ageModeSingle}</ToggleButton>
        <ToggleButton value="range">{RU.fields.ageModeRange}</ToggleButton>
      </ToggleButtonGroup>

      {mode === 'single' ? (
        <TextField
          label="Возраст"
          type="number"
          size="small"
          value={single.text}
          inputProps={{ min: 0, max: 150, inputMode: 'numeric' }}
          onChange={(e) => single.handleChange(e.target.value)}
        />
      ) : (
        <Stack direction="row" spacing={1}>
          <TextField
            label={RU.fields.ageFrom}
            type="number"
            size="small"
            value={fromField.text}
            inputProps={{ inputMode: 'numeric' }}
            onChange={(e) => fromField.handleChange(e.target.value)}
          />
          <TextField
            label={RU.fields.ageTo}
            type="number"
            size="small"
            value={toField.text}
            inputProps={{ inputMode: 'numeric' }}
            onChange={(e) => toField.handleChange(e.target.value)}
          />
        </Stack>
      )}
    </Stack>
  )
}
