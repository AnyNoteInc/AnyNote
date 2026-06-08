'use client'

import { Box, Typography } from '@repo/ui/components'

import type { DatabaseViewProps } from '../types'

/**
 * STUB — the CALENDAR layout lands in Phase F (a month grid placing rows on their
 * `layout.datePropertyId` day). Takes the shared `DatabaseViewProps` so the
 * renderer dispatch compiles today; Phase F fills it in against this interface.
 */
export function DatabaseCalendarView({ view }: DatabaseViewProps) {
  return (
    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
      <Typography color="text.secondary">
        Представление «{view.title}» (Календарь) в разработке
      </Typography>
    </Box>
  )
}
