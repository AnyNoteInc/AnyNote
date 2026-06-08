'use client'

import { Chip, MenuItem, Select } from '@repo/ui/components'

import type { DatabasePropertyView } from '../types'
import { optionsOf } from '../types'
import { useCellUpdate } from './use-optimistic-cell'

interface SelectCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly property: DatabasePropertyView
  readonly value: unknown
  readonly editable?: boolean
}

const NONE = '__none__'

/**
 * Single-select / status cell. Options come from `property.settings.options`;
 * the stored value is the chosen option id (or null when cleared).
 */
export function SelectCell({ pageId, rowId, property, value, editable = true }: SelectCellProps) {
  const { commit } = useCellUpdate(pageId)
  const options = optionsOf(property)
  const selectedId = typeof value === 'string' ? value : ''
  const selected = options.find((o) => o.id === selectedId)

  if (!editable) {
    return selected ? (
      <Chip
        size="small"
        label={selected.label}
        sx={selected.color ? { bgcolor: selected.color, color: '#fff' } : undefined}
      />
    ) : (
      <span />
    )
  }

  return (
    <Select
      value={selectedId || NONE}
      variant="standard"
      disableUnderline
      displayEmpty
      fullWidth
      onChange={(e) => {
        const next = e.target.value
        commit(rowId, property.id, next === NONE ? null : next)
      }}
      renderValue={() =>
        selected ? (
          <Chip
            size="small"
            label={selected.label}
            sx={selected.color ? { bgcolor: selected.color, color: '#fff' } : undefined}
          />
        ) : (
          <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>—</span>
        )
      }
      sx={{ fontSize: 14 }}
    >
      <MenuItem value={NONE}>
        <em>Не выбрано</em>
      </MenuItem>
      {options.map((option) => (
        <MenuItem key={option.id} value={option.id}>
          <Chip
            size="small"
            label={option.label}
            sx={option.color ? { bgcolor: option.color, color: '#fff' } : undefined}
          />
        </MenuItem>
      ))}
    </Select>
  )
}
