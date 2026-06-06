'use client'

import { Box, SearchIcon, Typography } from '@repo/ui/components'

/** Shown in the results area when a query matches no templates. */
export function TemplateEmptyState({ query }: { query: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        py: 6,
        px: 2,
        textAlign: 'center',
      }}
    >
      <SearchIcon sx={{ fontSize: 32, color: 'text.disabled' }} />
      <Typography variant="body2" color="text.secondary">
        Шаблоны не найдены
      </Typography>
      {query ? (
        <Typography variant="caption" color="text.disabled">
          По запросу «{query}» ничего нет
        </Typography>
      ) : null}
    </Box>
  )
}
