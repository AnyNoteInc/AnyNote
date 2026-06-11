import { Box, Container, Paper, Stack, Typography } from '@repo/ui/components'
import type { ReactNode } from 'react'

import { DevelopersNav } from './developers-nav'

type DevelopersShellProps = {
  children: ReactNode
}

/**
 * Two-column docs shell for the /developers section: a ~240px sidebar nav
 * (horizontal scroll row on mobile) and a content column. Stays RSC — the
 * active-state logic lives in the small client-side `DevelopersNav`.
 */
export function DevelopersShell({ children }: Readonly<DevelopersShellProps>) {
  return (
    <Container maxWidth="xl" sx={{ position: 'relative', pb: { xs: 8, md: 12 } }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: 'flex-start',
          gap: { xs: 3, md: 5 },
          pt: { xs: 3, md: 5 },
        }}
      >
        <Box
          component="aside"
          sx={{
            width: { xs: '100%', md: 240 },
            flexShrink: 0,
            position: { md: 'sticky' },
            top: { md: 96 },
          }}
        >
          <DevelopersNav />
        </Box>
        <Box component="article" sx={{ flexGrow: 1, minWidth: 0, maxWidth: 920 }}>
          {children}
        </Box>
      </Box>
    </Container>
  )
}

type DevelopersArticleProps = {
  title: string
  description: string
  children: ReactNode
}

/**
 * Page header + markdown body container for a /developers page. The Paper
 * mirrors the md-body styling of `PublicPageShell` (used by /terms and
 * /changelog); element typography comes from the global mdx-components.tsx.
 */
export function DevelopersArticle({
  title,
  description,
  children,
}: Readonly<DevelopersArticleProps>) {
  return (
    <>
      <Stack spacing={1.5}>
        <Typography variant="overline" color="text.secondary">
          Разработчикам
        </Typography>
        <Typography variant="h1" sx={{ fontSize: { xs: '2.2rem', md: '2.8rem' } }}>
          {title}
        </Typography>
        <Typography
          variant="h6"
          component="p"
          color="text.secondary"
          sx={{ maxWidth: 760, lineHeight: 1.6, fontSize: { xs: '1rem', md: '1.08rem' } }}
        >
          {description}
        </Typography>
      </Stack>

      <Paper
        elevation={0}
        sx={{
          mt: 4,
          p: { xs: 3, md: 4 },
          borderRadius: 2,
          border: '1px solid rgba(148,163,184,0.16)',
          backgroundColor: 'background.paper',
        }}
      >
        {children}
      </Paper>
    </>
  )
}
