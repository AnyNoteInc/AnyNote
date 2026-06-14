'use client'

import { Box, DeleteIcon, IconButton, SettingsIcon, Typography } from '@repo/ui/components'

interface WidgetFrameProps {
  /** The widget's display title (falls back to a muted placeholder when empty). */
  readonly title?: string | null
  /** When true (edit mode + editor), render the settings/remove affordances. */
  readonly editable?: boolean
  readonly onSettings?: () => void
  readonly onRemove?: () => void
  readonly children: React.ReactNode
}

/**
 * The shared card chrome around every dashboard widget: a header (title + the
 * edit-mode settings/remove buttons) over a flexible body. The body owns its own
 * scroll/overflow so a TABLE/chart widget fills the grid cell. The drag handle
 * class (`dashboard-widget-drag-handle`) lives on the header so react-grid-layout
 * (Task 5) can restrict dragging to the title bar without grabbing chart clicks.
 */
export function WidgetFrame({
  title,
  editable = false,
  onSettings,
  onRemove,
  children,
}: WidgetFrameProps) {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box
        className="dashboard-widget-drag-handle"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          cursor: editable ? 'move' : 'default',
        }}
      >
        <Typography
          variant="subtitle2"
          noWrap
          sx={{ flex: 1, minWidth: 0, color: title ? 'text.primary' : 'text.secondary' }}
        >
          {title || 'Без названия'}
        </Typography>
        {editable ? (
          <>
            <IconButton
              size="small"
              aria-label="Настройки виджета"
              onClick={onSettings}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label="Удалить виджет"
              color="error"
              onClick={onRemove}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </>
        ) : null}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5 }}>{children}</Box>
    </Box>
  )
}
