import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { LifeStatus } from '../../types/domain'
import { RU } from '../../i18n/ru'

interface Props {
  value: LifeStatus
  onChange: (next: LifeStatus) => void
}

export function LifeStatusToggle({ value, onChange }: Props) {
  return (
    <ToggleButtonGroup
      exclusive
      value={value}
      onChange={(_e, next: LifeStatus | null) => {
        if (next && next !== value) onChange(next)
      }}
    >
      <ToggleButton value="alive">{RU.fields.alive}</ToggleButton>
      <ToggleButton value="deceased">{RU.fields.deceased}</ToggleButton>
      <ToggleButton value="unknown">{RU.fields.unknown}</ToggleButton>
    </ToggleButtonGroup>
  )
}
