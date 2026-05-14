import { Menu, MenuItem } from '@mui/material'
import { RU } from '../i18n/ru'

export type AnnotationAction = 'edit' | 'move' | 'delete'

interface Props {
  readonly open: boolean
  readonly anchorEl: HTMLElement | null
  readonly onClose: () => void
  readonly onAction: (action: AnnotationAction) => void
}

/**
 * Note context menu shown after clicking an annotation on the canvas.
 * Mirrors the EdgeMenu pattern (MUI Menu + MenuItem) so all genogram menus
 * use the same component shape.
 */
export function AnnotationMenu({ open, anchorEl, onClose, onAction }: Props) {
  const items: { action: AnnotationAction; label: string }[] = [
    { action: 'edit', label: RU.menu.editNote },
    { action: 'move', label: RU.menu.moveNote },
    { action: 'delete', label: RU.menu.deleteNote },
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
