'use client'

import { Box, Stack, Typography } from '@repo/ui/components'

import { TemplateSearchInput } from '@/components/templates/template-search-input'

export function MarketplaceHeader({
  query,
  onQuery,
}: {
  query: string
  onQuery: (v: string) => void
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box sx={{ flex: 1, maxWidth: 420 }}>
        <TemplateSearchInput value={query} onChange={onQuery} />
      </Box>
      <Typography variant="body2" color="text.secondary">
        Маркетплейс
      </Typography>
    </Stack>
  )
}
