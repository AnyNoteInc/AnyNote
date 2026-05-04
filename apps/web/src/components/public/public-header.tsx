import Link from 'next/link'

import { Box, Button, Stack, Typography } from '@repo/ui/components'
import { ChangeColorTheme } from '@repo/ui/widgets'

import { AppUserMenu } from '@/components/app/app-user-menu'
import { Origami } from '@/components/public/home/origami'
import type { SessionType } from '@/lib/get-session'

import { publicNavItems } from './content'

type PublicHeaderProps = {
  session: SessionType
}

export function PublicHeader({ session }: PublicHeaderProps) {
  return (
    <Box
      sx={{
        py: 1.25,
        position: 'sticky',
        top: 0,
        zIndex: 20,
        backdropFilter: 'blur(14px)',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ px: { xs: 3, md: 4, xl: 5 } }}
      >
        <Link
          href="/"
          aria-label="На главную"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <Box sx={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
            <Origami variant="rhombus" size={28} gradient="warm" style={{ position: 'static' }} />
          </Box>
          <Typography
            sx={{
              fontFamily: 'var(--font-serif), Georgia, serif',
              fontSize: 17,
              fontWeight: 500,
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
            }}
          >
            Любые заметки
          </Typography>
        </Link>

        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{ display: { xs: 'none', lg: 'flex' } }}
        >
          {publicNavItems.map((item) => (
            <Button
              key={item.href}
              href={item.href}
              variant="text"
              color="inherit"
              sx={{ textTransform: 'none' }}
            >
              {item.label}
            </Button>
          ))}
        </Stack>

        <Stack direction="row" spacing={1.5} alignItems="center">
          <ChangeColorTheme />
          <AppUserMenu session={session} />
        </Stack>
      </Stack>
    </Box>
  )
}
