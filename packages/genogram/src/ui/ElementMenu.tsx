import { Menu, MenuItem } from '@mui/material'
import type { PersonRole, PersonSize } from '../types/domain'
import { RU } from '../i18n/ru'

export type ElementAction = 'edit-data' | 'edit-owner' | 'add-partner' | 'add-parents'

interface Props {
  open: boolean
  anchorEl: HTMLElement | null
  personSize: PersonSize
  personRole: PersonRole
  hasParents: boolean
  onClose: () => void
  onAction: (action: ElementAction) => void
}

export function ElementMenu({
  open,
  anchorEl,
  personSize,
  personRole,
  hasParents,
  onClose,
  onAction,
}: Props) {
  const items: { action: ElementAction; label: string }[] = []
  if (personSize === 'small') {
    items.push({ action: 'edit-data', label: RU.menu.editData })
  } else if (personRole === 'owner') {
    items.push({ action: 'edit-owner', label: RU.menu.editOwnerData })
    items.push({ action: 'add-partner', label: RU.menu.addPartner })
  } else {
    items.push({ action: 'edit-data', label: RU.menu.editData })
    items.push({ action: 'add-partner', label: RU.menu.addPartner })
    if (!hasParents) items.push({ action: 'add-parents', label: RU.menu.addParents })
  }

  return (
    <Menu open={open} anchorEl={anchorEl} onClose={onClose}>
      {items.map((it) => (
        <MenuItem
          key={it.action}
          onClick={() => {
            onAction(it.action)
            onClose()
          }}
        >
          {it.label}
        </MenuItem>
      ))}
    </Menu>
  )
}
