import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { Sex } from '../../types/domain'
import { RU } from '../../i18n/ru'

interface Props {
  value: Sex
  onChange: (next: Sex) => void
}

export function SexToggle({ value, onChange }: Props) {
  return (
    <ToggleButtonGroup
      exclusive
      value={value}
      onChange={(_e, next: Sex | null) => {
        if (next && next !== value) onChange(next)
      }}
    >
      <ToggleButton value="male">{RU.fields.sexMale}</ToggleButton>
      <ToggleButton value="female">{RU.fields.sexFemale}</ToggleButton>
    </ToggleButtonGroup>
  )
}
