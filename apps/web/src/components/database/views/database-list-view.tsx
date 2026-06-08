'use client'

import { Box, Typography } from '@repo/ui/components'

import type { DatabaseViewProps } from '../types'

/**
 * STUB — the LIST layout lands in Phase F (a compact vertical list of rows showing
 * title + `visibleProperties`). Takes the shared `DatabaseViewProps` so the
 * renderer dispatch compiles today; Phase F fills it in against this interface.
 */
export function DatabaseListView({ view }: DatabaseViewProps) {
  return (
    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
      <Typography color="text.secondary">
        Представление «{view.title}» (Список) в разработке
      </Typography>
    </Box>
  )
}
