'use client'

import { useState } from 'react'
import {
  AddIcon,
  Box,
  Checkbox,
  Chip,
  CloseIcon,
  Menu,
  MenuItem,
  Stack,
} from '@repo/ui/components'

import type { DatabasePropertyView } from '../types'
import { optionsOf } from '../types'
import { useCellUpdate } from './use-optimistic-cell'

interface MultiSelectCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly property: DatabasePropertyView
  readonly value: unknown
  readonly editable?: boolean
}

/** Coerce the stored value (a `string[]` of option ids) defensively. */
function toIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/**
 * Multi-select cell. Options come from `property.settings.options`; the stored
 * value is a `string[]` of the chosen option ids. Selected chips render with
 * their colour; a "+" opens a checklist menu to toggle options on/off. Mirrors
 * `select-cell.tsx` but multi-valued, committing the full id array each change.
 */
export function MultiSelectCell({
  pageId,
  rowId,
  property,
  value,
  editable = true,
}: MultiSelectCellProps) {
  const { commit } = useCellUpdate(pageId)
  const options = optionsOf(property)
  const selectedIds = toIds(value)
  const selectedOptions = options.filter((o) => selectedIds.includes(o.id))

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  function toggle(optionId: string) {
    const next = selectedIds.includes(optionId)
      ? selectedIds.filter((id) => id !== optionId)
      : [...selectedIds, optionId]
    commit(rowId, property.id, next.length === 0 ? null : next)
  }

  if (!editable) {
    return (
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {selectedOptions.map((o) => (
          <Chip
            key={o.id}
            size="small"
            label={o.label}
            sx={o.color ? { bgcolor: o.color, color: '#fff' } : undefined}
          />
        ))}
      </Stack>
    )
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
      {selectedOptions.map((o) => (
        <Chip
          key={o.id}
          size="small"
          label={o.label}
          onDelete={() => toggle(o.id)}
          deleteIcon={<CloseIcon />}
          sx={o.color ? { bgcolor: o.color, color: '#fff', '& .MuiChip-deleteIcon': { color: '#fff' } } : undefined}
        />
      ))}
      <Chip
        size="small"
        variant="outlined"
        icon={<AddIcon />}
        label="Добавить"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ cursor: 'pointer' }}
      />
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {options.length === 0 ? (
          <MenuItem disabled>
            <em>Нет вариантов</em>
          </MenuItem>
        ) : (
          options.map((option) => {
            const checked = selectedIds.includes(option.id)
            return (
              <MenuItem key={option.id} onClick={() => toggle(option.id)} dense>
                <Checkbox checked={checked} size="small" sx={{ p: 0.5, mr: 1 }} />
                <Chip
                  size="small"
                  label={option.label}
                  sx={option.color ? { bgcolor: option.color, color: '#fff' } : undefined}
                />
              </MenuItem>
            )
          })
        )}
      </Menu>
    </Box>
  )
}
