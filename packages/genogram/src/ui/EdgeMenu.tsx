import { Menu, MenuItem } from '@mui/material'
import { RU } from '../i18n/ru'

export type EdgeAction = 'edit-connection' | 'add-children'

interface Props {
  open: boolean
  anchorEl: HTMLElement | null
  onClose: () => void
  onAction: (action: EdgeAction) => void
}

export function EdgeMenu({ open, anchorEl, onClose, onAction }: Props) {
  const items: { action: EdgeAction; label: string }[] = [
    { action: 'edit-connection', label: RU.menu.editConnection },
    { action: 'add-children', label: RU.menu.addChildren },
  ]
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
