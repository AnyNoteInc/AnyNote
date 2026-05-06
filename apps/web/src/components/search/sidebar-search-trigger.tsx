'use client'

import {
  ListItemButton,
  ListItemIcon,
  ListItemText,
  SearchIcon,
  Typography,
} from '@repo/ui/components'

import { useSearchDialog } from './search-dialog-provider'

export function SidebarSearchTrigger() {
  const { open } = useSearchDialog()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const hint = isMac ? '⌘K' : 'Alt+K'

  return (
    <ListItemButton
      onClick={open}
      disableGutters
      aria-label="Открыть поиск"
      sx={{
        gap: 1,
        px: 1,
        py: 0.75,
        borderRadius: 0.75,
        color: 'text.secondary',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <ListItemIcon sx={{ minWidth: 16, color: 'inherit' }}>
        <SearchIcon sx={{ fontSize: 16 }} />
      </ListItemIcon>
      <ListItemText
        primary="Поиск"
        primaryTypographyProps={{ fontSize: 13, noWrap: true }}
        sx={{ minWidth: 0, my: 0 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', flexShrink: 0 }}>
        {hint}
      </Typography>
    </ListItemButton>
  )
}
