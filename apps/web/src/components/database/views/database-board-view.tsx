'use client'

import { Box, Typography } from '@repo/ui/components'

import type { DatabaseViewProps } from '../types'

/**
 * STUB — the BOARD layout lands in Phase F (`useGroupedRows` + @hello-pangea/dnd
 * columns derived from the groupBy property's options). It takes the shared
 * `DatabaseViewProps` so the renderer's view dispatch compiles today; Phase F
 * fills in the real board against this exact prop interface.
 */
export function DatabaseBoardView({ view }: DatabaseViewProps) {
  return (
    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
      <Typography color="text.secondary">
        Представление «{view.title}» (Доска) в разработке
      </Typography>
    </Box>
  )
}
