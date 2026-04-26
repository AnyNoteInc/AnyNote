import type { Metadata } from 'next'

import { Box, Chip, Paper, Stack, Typography } from '@repo/ui/components'

import { integrationCards } from '@/components/public/content'
import { PublicPageShell } from '@/components/public/public-page-shell'

export const metadata: Metadata = {
  title: 'Для разработчиков',
}

export default function DevelopersPage() {
  return (
    <PublicPageShell
      eyebrow="Для разработчиков"
      title="Приоритетные интеграции для российского рынка"
      description="На старте концентрируемся на системах, которые чаще всего встречаются в российских командах продаж, поддержки и внутреннего документооборота."
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
          gap: 3,
        }}
      >
        {integrationCards.map((integration) => (
          <Paper
            key={integration.title}
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 2,
              border: '1px solid rgba(148,163,184,0.16)',
              backgroundColor: 'background.paper',
            }}
          >
            <Stack spacing={2}>
              <Stack spacing={0.75}>
                <Typography variant="overline" color="text.secondary">
                  {integration.eyebrow}
                </Typography>
                <Typography variant="h4">{integration.title}</Typography>
              </Stack>
              <Typography color="text.secondary">{integration.description}</Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {integration.highlights.map((item) => (
                  <Chip key={item} label={item} variant="outlined" />
                ))}
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Box>
    </PublicPageShell>
  )
}
