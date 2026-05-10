import { Menu, MenuItem } from '@mui/material'
import { RU } from '../i18n/ru'

export type PaneAction = 'add-note'

interface Props {
  open: boolean
  anchorEl: HTMLElement | null
  onClose: () => void
  onAction: (action: PaneAction) => void
}

/**
 * Floating menu that appears when the user double-clicks an empty area of
 * the genogram canvas. Currently exposes a single "Add note" action;
 * structured the same as EdgeMenu so future pane-level actions can extend
 * the items array.
 */
export function PaneMenu({ open, anchorEl, onClose, onAction }: Props) {
  const items: { action: PaneAction; label: string }[] = [
    { action: 'add-note', label: RU.menu.addNote },
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
